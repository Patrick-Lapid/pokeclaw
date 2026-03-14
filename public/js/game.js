// POKECLAW — HTML Canvas Game Engine
// PMD-style per-action sprite sheets (per species)
// Directions: 0=down, 1=down-right, 2=right, 3=up-right, 4=up, 5=up-left, 6=left, 7=down-left

var TILE = 24
var COLS = 50
var ROWS = 32

var collisionGrid = null // populated from town.json collision layer
var WALK_SPEED_BASE = 50
var WALK_CYCLES_PER_TILE = 1
var WANDER_PAUSE_MIN = 3000
var WANDER_PAUSE_MAX = 9000
var REMOVAL_DELAY = 30000

var DIR_TO_PMD = { down: 0, 'down-right': 1, right: 2, 'up-right': 3, up: 4, 'up-left': 5, left: 6, 'down-left': 7 }
var DIRS = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left']

var STATE_ANIM = { walk: 'Walk', idle: 'Idle', work: 'Pose', attack: 'Attack', shock: 'Shock', eat: 'Eat' }
var PERFORM_ACTIONS = ['attack', 'shock', 'eat', 'work']

var FPS_POKEMON_ANIMS = 36
var PERFORM_DURATION_MIN = 1500
var PERFORM_DURATION_MAX = 3500

var SHADOW_IDLE_ACTIONS = { Attack: 1, Hop: 1, Hurt: 1, Shock: 1 }

var TYPE_COLORS = {
  fire: '#f06030', water: '#3088d0', grass: '#40a030', electric: '#f0d020',
  psychic: '#9058c0', steel: '#8898a8', ground: '#a07848', dark: '#585060',
  fairy: '#e888c8', fighting: '#c03028', rock: '#a8a060', ghost: '#6060b0',
  bug: '#88a020', dragon: '#5828d8', normal: '#a0a078', ice: '#60c8d8',
  flying: '#8070e0', poison: '#8040a0'
}

var NESTS = [
  { id: 'nest-0', col: 16, row: 6, dir: 'down', assigned: false },
  { id: 'nest-1', col: 20, row: 6, dir: 'down', assigned: false },
  { id: 'nest-2', col: 24, row: 6, dir: 'down', assigned: false },
  { id: 'nest-3', col: 18, row: 8, dir: 'down', assigned: false },
  { id: 'nest-4', col: 22, row: 8, dir: 'down', assigned: false },
  { id: 'nest-5', col: 16, row: 10, dir: 'right', assigned: false },
  { id: 'nest-6', col: 20, row: 10, dir: 'down', assigned: false },
  { id: 'nest-7', col: 24, row: 10, dir: 'left', assigned: false },
  { id: 'nest-8', col: 18, row: 12, dir: 'down', assigned: false },
  { id: 'nest-9', col: 22, row: 12, dir: 'down', assigned: false }
]

// Tile map

var tileData = []
var townMapData = null    // parsed town.json
var tilesetImage = null   // tileset.png
var tilesetReady = false
var TILESET_COLS = 25     // tileset.png is 600px wide / 24px per tile
var TILESET_TILE = 24     // each tile in the tileset is 24x24

function initTileData() {
  for (var r = 0; r < ROWS; r++) {
    tileData[r] = []
    for (var c = 0; c < COLS; c++) {
      tileData[r][c] = ((r + c) % 2 === 0) ? 1 : 2
    }
  }
}

function loadTileset(callback) {
  var img = new Image()
  img.onload = function() {
    tilesetImage = img
    fetch('/assets/tilemaps/town.json')
      .then(function(r) { return r.json() })
      .then(function(data) {
        townMapData = data
        // Build collision grid from the dedicated collision layer
        var collisionLayer = null
        for (var li = 0; li < data.layers.length; li++) {
          if (data.layers[li].name === 'collision') {
            collisionLayer = data.layers[li].data
            break
          }
        }
        collisionGrid = []
        for (var r = 0; r < ROWS; r++) {
          collisionGrid[r] = []
          for (var c = 0; c < COLS; c++) {
            var idx = r * data.width + c
            collisionGrid[r][c] = collisionLayer ? collisionLayer[idx] > 0 : false
          }
        }
        tilesetReady = true
        drawStaticTerrain()
        if (callback) callback()
      })
  }
  img.src = '/assets/tilemaps/tileset.png'
}

// Pathfinding

function isWalkable(col, row) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false
  if (!collisionGrid) return false
  return !collisionGrid[row][col]
}

function isTileOccupied(col, row, excludeId) {
  var occupied = false
  pokemon.forEach(function(cr) {
    if (cr.id === excludeId) return
    // Check current tile
    if (cr.col === col && cr.row === row) { occupied = true; return }
    // Check walk destination
    if (cr.state === 'walk' && cr.path && cr.path.length > 0) {
      var dest = cr.path[cr.path.length - 1]
      if (dest.col === col && dest.row === row) { occupied = true; return }
    }
  })
  return occupied
}

function findPath(sc, sr, ec, er) {
  if (sc === ec && sr === er) return []
  if (!isWalkable(ec, er)) return []

  var queue = [[sc, sr]]
  var visited = new Set()
  visited.add(sc + ',' + sr)
  var parent = new Map()
  var dirs = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]

  while (queue.length > 0) {
    var cur = queue.shift()
    if (cur[0] === ec && cur[1] === er) {
      var path = []
      var key = ec + ',' + er
      while (parent.has(key)) {
        var parts = key.split(',')
        path.unshift({ col: parseInt(parts[0]), row: parseInt(parts[1]) })
        key = parent.get(key)
      }
      return path
    }
    for (var d = 0; d < dirs.length; d++) {
      var nx = cur[0] + dirs[d][0], ny = cur[1] + dirs[d][1]
      var nk = nx + ',' + ny
      if (!visited.has(nk) && isWalkable(nx, ny)) {
        visited.add(nk)
        parent.set(nk, cur[0] + ',' + cur[1])
        queue.push([nx, ny])
      }
    }
  }
  return []
}

// SpriteManager — per-species lazy loading of action sheets

var SpriteManager = {
  cache: {},     // dexNum → { animData, sheets: {}, ready }
  loading: {},   // dexNum → true

  load: function(dexNum) {
    if (this.cache[dexNum] || this.loading[dexNum]) return
    this.loading[dexNum] = true

    var self = this
    var entry = { animData: {}, sheets: {}, ready: false }

    fetch('/assets/sprites/' + dexNum + '/anim-data.json')
      .then(function(r) { return r.json() })
      .then(function(data) {
        entry.animData = data

        // Load action sheets we need
        var actions = ['Idle', 'Walk', 'Attack', 'Pose', 'Eat', 'Hop', 'Hurt', 'Sleep', 'Shock']
        var pending = 0
        var loaded = 0

        actions.forEach(function(action) {
          if (!data[action]) return

          // Load anim sheet
          pending++
          var animImg = new Image()
          animImg.onload = function() {
            entry.sheets[action + '-Anim'] = animImg
            loaded++
            if (loaded >= pending) finalize()
          }
          animImg.onerror = function() {
            loaded++
            if (loaded >= pending) finalize()
          }
          animImg.src = '/assets/sprites/' + dexNum + '/' + action + '-Anim.png'

          // Load shadow sheet, filter by shadowSize, flatten to black
          pending++
          var shadowImg = new Image()
          shadowImg.onload = function() {
            var c = document.createElement('canvas')
            c.width = shadowImg.naturalWidth
            c.height = shadowImg.naturalHeight
            var sc = c.getContext('2d')
            sc.drawImage(shadowImg, 0, 0)
            var imgData = sc.getImageData(0, 0, c.width, c.height)
            var d = imgData.data
            var ss = (data._shadowSize !== undefined) ? data._shadowSize : 2
            for (var pi = 0; pi < d.length; pi += 4) {
              if (d[pi + 3] === 0) continue
              var r = d[pi], g = d[pi + 1], b = d[pi + 2]
              // ShadowSize 0: remove red and blue marker pixels (nearly no shadow)
              // ShadowSize 1: remove blue marker pixels (smaller shadow)
              // ShadowSize 2+: keep everything (full shadow)
              var isRed = r > 128 && g < 64 && b < 64
              var isBlue = b > 128 && r < 64 && g < 64
              if (ss === 0 && (isRed || isBlue)) { d[pi + 3] = 0; continue }
              if (ss === 1 && isBlue) { d[pi + 3] = 0; continue }
              // Flatten remaining to black
              d[pi] = 0; d[pi + 1] = 0; d[pi + 2] = 0
            }
            sc.putImageData(imgData, 0, 0)
            entry.sheets[action + '-Shadow'] = c
            loaded++
            if (loaded >= pending) finalize()
          }
          shadowImg.onerror = function() {
            loaded++
            if (loaded >= pending) finalize()
          }
          shadowImg.src = '/assets/sprites/' + dexNum + '/' + action + '-Shadow.png'
        })

        if (pending === 0) finalize()

        function finalize() {
          entry.ready = true
          self.cache[dexNum] = entry
          delete self.loading[dexNum]
        }
      })
      .catch(function() {
        delete self.loading[dexNum]
      })
  },

  get: function(dexNum) {
    return this.cache[dexNum] || null
  },

  _resolveAnim: function(dexNum, actionName) {
    var entry = this.cache[dexNum]
    if (!entry || !entry.ready) return null
    var anim = entry.animData[actionName]
    if (!anim) { anim = entry.animData['Idle']; actionName = 'Idle' }
    if (!anim) return null
    return { entry: entry, anim: anim, actionName: actionName }
  },

  _buildFrame: function(resolved, suffix, direction, frameIndex) {
    var sheet = resolved.entry.sheets[resolved.actionName + '-' + suffix]
    if (!sheet) return null
    var anim = resolved.anim
    var fi = frameIndex % anim.numFrames
    var h = sheet.naturalHeight || sheet.height
    var numRows = Math.floor(h / anim.frameHeight) || 1
    var dir = numRows >= 8 ? direction : 0
    return {
      sheet: sheet,
      sx: fi * anim.frameWidth,
      sy: dir * anim.frameHeight,
      sw: anim.frameWidth,
      sh: anim.frameHeight
    }
  },

  getFrame: function(dexNum, actionName, direction, frameIndex) {
    var resolved = this._resolveAnim(dexNum, actionName)
    return resolved ? this._buildFrame(resolved, 'Anim', direction, frameIndex) : null
  },

  getShadowFrame: function(dexNum, actionName, direction, frameIndex) {
    var resolved = this._resolveAnim(dexNum, actionName)
    return resolved ? this._buildFrame(resolved, 'Shadow', direction, frameIndex) : null
  },

  getAnimInfo: function(dexNum, actionName) {
    var resolved = this._resolveAnim(dexNum, actionName)
    return resolved ? resolved.anim : null
  },

  getWalkSpeed: function(dexNum) {
    var anim = this.getAnimInfo(dexNum, 'Walk')
    if (!anim || !anim.durations || anim.durations.length === 0) return WALK_SPEED_BASE
    var totalTicks = 0
    for (var i = 0; i < anim.durations.length; i++) totalTicks += anim.durations[i]
    var cycleDurationMs = totalTicks * (1000 / FPS_POKEMON_ANIMS)
    // Speed = pixels/sec to cross one tile in exactly WALK_CYCLES_PER_TILE animation cycles
    return TILE / (cycleDurationMs * WALK_CYCLES_PER_TILE / 1000)
  }
}

// Camera

var camera = { x: 0, y: 0, zoom: 0, minZoom: 1, maxZoom: 6 }

var MAP_W = COLS * TILE
var MAP_H = ROWS * TILE

function viewW() { return canvas.width / (window.devicePixelRatio || 1) }
function viewH() { return canvas.height / (window.devicePixelRatio || 1) }

function clampCamera() {
  // Compute minimum zoom so at most 70% of the map is visible
  var fitZoom = Math.max(viewW() / MAP_W, viewH() / MAP_H) / 0.7
  camera.minZoom = fitZoom
  if (camera.zoom < camera.minZoom) camera.zoom = camera.minZoom

  // Clamp pan so no area outside the map is visible
  var halfViewW = (viewW() / 2) / camera.zoom
  var halfViewH = (viewH() / 2) / camera.zoom
  camera.x = Math.max(halfViewW, Math.min(MAP_W - halfViewW, camera.x))
  camera.y = Math.max(halfViewH, Math.min(MAP_H - halfViewH, camera.y))
}

function worldToScreen(wx, wy) {
  var cx = viewW() / 2
  var cy = viewH() / 2
  return {
    x: (wx - camera.x) * camera.zoom + cx,
    y: (wy - camera.y) * camera.zoom + cy
  }
}

function screenToWorld(sx, sy) {
  var cx = viewW() / 2
  var cy = viewH() / 2
  return {
    x: (sx - cx) / camera.zoom + camera.x,
    y: (sy - cy) / camera.zoom + camera.y
  }
}

// Canvas

var canvas, ctx
var terrainCanvas, terrainCtx
var lastTime = 0

function initCanvas() {
  var container = document.getElementById('game-container')
  canvas = document.createElement('canvas')
  canvas.style.imageRendering = 'pixelated'
  container.appendChild(canvas)
  ctx = canvas.getContext('2d')

  terrainCanvas = document.createElement('canvas')
  terrainCanvas.width = COLS * TILE
  terrainCanvas.height = ROWS * TILE
  terrainCtx = terrainCanvas.getContext('2d')

  camera.x = (COLS / 2) * TILE
  camera.y = (ROWS / 2) * TILE
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
}

function resizeCanvas() {
  var container = document.getElementById('game-container')
  var dpr = window.devicePixelRatio || 1
  canvas.width = container.clientWidth * dpr
  canvas.height = container.clientHeight * dpr
  canvas.style.width = container.clientWidth + 'px'
  canvas.style.height = container.clientHeight + 'px'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  clampCamera()
  drawStaticTerrain()
}

// Spatial grid for fast hit testing

var spatialGrid = {}
var GRID_CELL = TILE * 2 // each cell covers 2x2 tiles

function spatialKey(col, row) { return col + ',' + row }

function spatialGridCell(wx, wy) {
  return { c: Math.floor(wx / GRID_CELL), r: Math.floor(wy / GRID_CELL) }
}

function rebuildSpatialGrid() {
  spatialGrid = {}
  pokemon.forEach(function(cr) {
    var cell = spatialGridCell(cr.x, cr.y)
    var key = spatialKey(cell.c, cell.r)
    if (!spatialGrid[key]) spatialGrid[key] = []
    spatialGrid[key].push(cr)
  })
}

function hitTestPokemon(sx, sy) {
  var world = screenToWorld(sx, sy)
  var cell = spatialGridCell(world.x, world.y)
  var hit = null
  var minDist = TILE * 0.75
  var minDistSq = minDist * minDist
  // Check the cell and its 8 neighbors
  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      var key = spatialKey(cell.c + dc, cell.r + dr)
      var bucket = spatialGrid[key]
      if (!bucket) continue
      for (var i = 0; i < bucket.length; i++) {
        var cr = bucket[i]
        var dx = world.x - cr.x
        var dy = world.y - cr.y
        var distSq = dx * dx + dy * dy
        if (distSq < minDistSq) {
          minDistSq = distSq
          hit = cr
        }
      }
    }
  }
  return hit
}

// Input

var dragState = { dragging: false, moved: false, lastX: 0, lastY: 0, target: null }

function initInput() {
  canvas.addEventListener('pointerdown', function(e) {
    var rect = canvas.getBoundingClientRect()
    var sx = e.clientX - rect.left
    var sy = e.clientY - rect.top
    var hit = hitTestPokemon(sx, sy)

    dragState.dragging = true
    dragState.moved = false
    dragState.lastX = e.clientX
    dragState.lastY = e.clientY
    dragState.target = hit
    hideHoverCard()

    if (hit) {
      selectedId = hit.id
      hit.state = 'idle'
      hit.path = []
      hit.moveProgress = 0
      hit.animFrame = 0
      hit.animTimer = 0

      canvas.style.cursor = "url('/assets/cursors/cursor-grabbing.png') 12 12, grabbing"
    }
  })

  window.addEventListener('pointermove', function(e) {
    if (!dragState.dragging) return
    var dx = e.clientX - dragState.lastX
    var dy = e.clientY - dragState.lastY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true

    if (dragState.target) {
      // Drag pokemon
      var cr = dragState.target
      cr.x += dx / camera.zoom
      cr.y += dy / camera.zoom
      cr.col = Math.round((cr.x - TILE / 2) / TILE)
      cr.row = Math.round((cr.y - TILE / 2) / TILE)
      canvas.style.cursor = "url('/assets/cursors/cursor-grabbing.png') 12 12, grabbing"
    } else {
      // Pan camera
      camera.x -= dx / camera.zoom
      camera.y -= dy / camera.zoom
      clampCamera()
      canvas.style.cursor = "url('/assets/cursors/cursor-grabbing.png') 12 12, grabbing"
    }

    dragState.lastX = e.clientX
    dragState.lastY = e.clientY
  })

  window.addEventListener('pointerup', function(e) {
    if (dragState.target) {
      // Snap pokemon to grid on drop
      var cr = dragState.target
      cr.col = Math.max(0, Math.min(COLS - 1, Math.round((cr.x - TILE / 2) / TILE)))
      cr.row = Math.max(0, Math.min(ROWS - 1, Math.round((cr.y - TILE / 2) / TILE)))
      // Snap to nearest walkable tile if dropped on a blocked tile
      if (!isWalkable(cr.col, cr.row)) {
        var found = false
        for (var radius = 1; radius < 10 && !found; radius++) {
          for (var dr = -radius; dr <= radius && !found; dr++) {
            for (var dc = -radius; dc <= radius && !found; dc++) {
              if (Math.abs(dr) === radius || Math.abs(dc) === radius) {
                var nc = cr.col + dc, nr = cr.row + dr
                if (isWalkable(nc, nr)) {
                  cr.col = nc; cr.row = nr; found = true
                }
              }
            }
          }
        }
      }
      cr.x = cr.col * TILE + TILE / 2
      cr.y = cr.row * TILE + TILE / 2
      // Resume wandering from new position
      cr.path = []
      cr.state = 'idle'
      cr.animFrame = 0
      cr.animTimer = 0
      cr.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
      canvas.style.cursor = "url('/assets/cursors/cursor-grab.png') 12 12, grab"
    } else if (!dragState.moved && dragState.dragging) {
      var rect = canvas.getBoundingClientRect()
      handleClick(e.clientX - rect.left, e.clientY - rect.top)
    }
    canvas.style.cursor = "url('/assets/cursors/cursor-grab.png') 12 12, grab"
    dragState.dragging = false
    dragState.target = null
  })

  var lastHoverTime = 0
  var HOVER_THROTTLE = 50 // ms between hover hit tests
  canvas.addEventListener('pointermove', function(e) {
    lastMouseX = e.clientX
    lastMouseY = e.clientY
    if (dragState.dragging) { hideHoverCard(); return }
    // Always reposition if card is visible (cheap — no DOM read)
    if (hoverCardVisible) positionHoverCard(e.clientX, e.clientY)
    // Throttle hit testing
    var now = performance.now()
    if (now - lastHoverTime < HOVER_THROTTLE) return
    lastHoverTime = now
    var rect = canvas.getBoundingClientRect()
    var sx = e.clientX - rect.left
    var sy = e.clientY - rect.top
    var hit = hitTestPokemon(sx, sy)
    if (hit) {
      if (hoveredPokemonId !== hit.id) {
        showHoverCard(hit, e.clientX, e.clientY)
      }
    } else {
      hideHoverCard()
    }
  })

  canvas.addEventListener('pointerleave', function() {
    hideHoverCard()
  })

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault()
    var delta = e.deltaY > 0 ? -0.25 : 0.25
    camera.zoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom + delta))
    clampCamera()
  }, { passive: false })

  document.getElementById('zoomIn').addEventListener('click', function() {
    camera.zoom = Math.min(camera.maxZoom, camera.zoom + 0.5)
    clampCamera()
  })
  document.getElementById('zoomOut').addEventListener('click', function() {
    camera.zoom = Math.max(camera.minZoom, camera.zoom - 0.5)
    clampCamera()
  })
}

function handleClick(sx, sy) {
  var world = screenToWorld(sx, sy)
  var hit = null
  var minDist = TILE * 0.75

  pokemon.forEach(function(cr) {
    var dx = world.x - cr.x
    var dy = world.y - cr.y
    var dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < minDist) {
      minDist = dist
      hit = cr.id
    }
  })

  if (selectedId !== hit) {
    selectedId = hit
  }
}

// Terrain

function drawStaticTerrain() {
  var g = terrainCtx
  g.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height)

  if (!tilesetReady || !townMapData || !tilesetImage) {
    // Fallback checkerboard while loading
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        g.fillStyle = (tileData[r][c] === 1) ? '#2d5a1e' : '#275018'
        g.fillRect(c * TILE, r * TILE, TILE, TILE)
      }
    }
    return
  }

  // Render each layer from the Tiled map
  var layers = townMapData.layers
  for (var li = 0; li < layers.length; li++) {
    var layer = layers[li]
    if (layer.type !== 'tilelayer' || !layer.visible) continue
    var data = layer.data
    var w = layer.width
    for (var i = 0; i < data.length; i++) {
      var tileId = data[i]
      if (tileId <= 0) continue // 0 = empty/transparent
      tileId -= 1 // Tiled uses 1-based indices
      var srcCol = tileId % TILESET_COLS
      var srcRow = Math.floor(tileId / TILESET_COLS)
      var destCol = i % w
      var destRow = Math.floor(i / w)
      g.drawImage(
        tilesetImage,
        srcCol * TILESET_TILE, srcRow * TILESET_TILE, TILESET_TILE, TILESET_TILE,
        destCol * TILE, destRow * TILE, TILE, TILE
      )
    }
  }
}

// Pokemon Entity

var pokemon = new Map()
var removalTimers = new Map()
var endedSessions = new Set()
var selectedId = null

function PokemonEntity(sessionId, species, startCol, startRow, nestRef) {
  this.id = sessionId
  this.species = species
  this.speciesId = species.id
  this.dexNum = species.dexNum
  this.nest = nestRef
  this.state = 'idle'
  this.dir = nestRef ? nestRef.dir : 'down'
  this.col = startCol
  this.row = startRow
  this.x = startCol * TILE + TILE / 2
  this.y = startRow * TILE + TILE / 2
  this.path = []
  this.moveProgress = 0
  this.isActive = true
  this.statusText = 'ready!'
  this.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
  this.performTimer = 0
  this.animFrame = 0
  this.animTimer = 0
  this.username = null
  this.prompt = null
  this.spawnTime = performance.now()
}

PokemonEntity.prototype.getActionName = function() {
  return STATE_ANIM[this.state] || 'Idle'
}

PokemonEntity.prototype.getAnimInfo = function() {
  return SpriteManager.getAnimInfo(this.dexNum, this.getActionName())
}

PokemonEntity.prototype.getFrameDurationMs = function(durations, frameIndex) {
  if (!durations || durations.length === 0) return 200
  var ticks = durations[frameIndex % durations.length] || 1
  return ticks * (1000 / FPS_POKEMON_ANIMS)
}

PokemonEntity.prototype.update = function(dt) {
  if (dragState.target === this) return
  // Per-frame duration animation
  var animInfo = this.getAnimInfo()
  if (animInfo) {
    this.animTimer += dt
    var frameDur = this.getFrameDurationMs(animInfo.durations, this.animFrame)
    if (this.animTimer >= frameDur) {
      this.animTimer -= frameDur
      this.animFrame = (this.animFrame + 1) % animInfo.numFrames
    }
  }

  // Perform actions (attack, shock, eat, work/pose)
  if (this.state === 'attack' || this.state === 'shock' || this.state === 'eat' || this.state === 'work') {
    this.performTimer -= dt
    if (this.performTimer <= 0) {
      this.state = 'idle'
      this.animFrame = 0
      this.animTimer = 0
      this.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
    }
    return
  }

  // Idle: decide to wander or perform
  if (this.state === 'idle') {
    this.wanderTimer -= dt
    if (this.wanderTimer <= 0) {
      // Check which actions have sprites loaded for this species
      var availableActions = []
      for (var ai = 0; ai < PERFORM_ACTIONS.length; ai++) {
        var actionName = STATE_ANIM[PERFORM_ACTIONS[ai]]
        if (SpriteManager.getAnimInfo(this.dexNum, actionName)) {
          availableActions.push(PERFORM_ACTIONS[ai])
        }
      }

      if (availableActions.length > 0 && Math.random() < 0.4) {
        var action = availableActions[Math.floor(Math.random() * availableActions.length)]
        this.state = action
        this.animFrame = 0
        this.animTimer = 0
        this.performTimer = randRange(PERFORM_DURATION_MIN, PERFORM_DURATION_MAX)
        this.dir = DIRS[Math.floor(Math.random() * DIRS.length)]
      } else {
        for (var att = 0; att < 20; att++) {
          var rc = Math.floor(Math.random() * COLS)
          var rr = Math.floor(Math.random() * ROWS)
          if (isWalkable(rc, rr) && !isTileOccupied(rc, rr, this.id)) {
            this.path = findPath(this.col, this.row, rc, rr)
            if (this.path.length > 0 && this.path.length < 15) break
          }
        }
        if (this.path && this.path.length > 0) {
          this.state = 'walk'
          this.moveProgress = 0
          this.animFrame = 0
          this.animTimer = 0
        }
      }
      this.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
    }
    return
  }

  // Walking
  if (this.state === 'walk') {
    var walkSpeed = SpriteManager.getWalkSpeed(this.dexNum)
    this.moveProgress += (walkSpeed / TILE) * (dt / 1000)
    if (this.path.length === 0) {
      this.finishWalk()
      return
    }

    var next = this.path[0]
    var fromX = this.col * TILE + TILE / 2
    var fromY = this.row * TILE + TILE / 2
    var toX = next.col * TILE + TILE / 2
    var toY = next.row * TILE + TILE / 2

    var dc = next.col - this.col
    var dr = next.row - this.row
    if (dc === 0 && dr < 0) this.dir = 'up'
    else if (dc === 0 && dr > 0) this.dir = 'down'
    else if (dc < 0 && dr === 0) this.dir = 'left'
    else if (dc > 0 && dr === 0) this.dir = 'right'
    else if (dc > 0 && dr < 0) this.dir = 'up-right'
    else if (dc < 0 && dr < 0) this.dir = 'up-left'
    else if (dc > 0 && dr > 0) this.dir = 'down-right'
    else if (dc < 0 && dr > 0) this.dir = 'down-left'

    var t = Math.min(this.moveProgress, 1)
    this.x = fromX + (toX - fromX) * t
    this.y = fromY + (toY - fromY) * t

    if (this.moveProgress >= 1) {
      this.col = next.col
      this.row = next.row
      this.x = toX
      this.y = toY
      this.path.shift()
      this.moveProgress = 0
      if (this.path.length === 0) this.finishWalk()
    }
  }
}

PokemonEntity.prototype.finishWalk = function() {
  this.state = 'idle'
  this.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
  this.animFrame = 0
  this.animTimer = 0
}

PokemonEntity.prototype.draw = function(ctx) {
  var actionName = this.getActionName()
  var pmdDir = DIR_TO_PMD[this.dir]
  if (pmdDir === undefined) pmdDir = 0
  var screen = worldToScreen(this.x, this.y)
  var scale = camera.zoom * 1.0

  var frame = SpriteManager.getFrame(this.dexNum, actionName, pmdDir, this.animFrame)

  if (!frame) {
    // Placeholder: colored circle with type color
    var r = 8 * scale
    var typeColor = TYPE_COLORS[this.species.type] || '#888'
    ctx.fillStyle = typeColor
    ctx.globalAlpha = 0.6
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1.0
    // Still draw username and labels below
    this.drawLabels(ctx, screen, scale)
    return
  }

  // Draw shadow — use Idle for actions with larger frames (Attack, Hop, Hurt)
  // to prevent drift from rush offsets baked into the sprite sheet.
  // PAC avoids this via TexturePacker trim offsets; we use raw sheets.
  var shadowAction = SHADOW_IDLE_ACTIONS[actionName] ? 'Idle' : actionName
  var shadowFrame = SHADOW_IDLE_ACTIONS[actionName] ? 0 : this.animFrame
  var shadow = SpriteManager.getShadowFrame(this.dexNum, shadowAction, pmdDir, shadowFrame)
  if (shadow) {
    ctx.drawImage(
      shadow.sheet,
      shadow.sx, shadow.sy, shadow.sw, shadow.sh,
      screen.x - (shadow.sw / 2) * scale,
      screen.y - (shadow.sh / 2) * scale,
      shadow.sw * scale, shadow.sh * scale
    )
  }

  var drawX = screen.x - (frame.sw / 2) * scale
  var drawY = screen.y - (frame.sh / 2) * scale
  var drawW = frame.sw * scale
  var drawH = frame.sh * scale

  // Legendary glow effect
  if (this.species.rarity >= 3) {
    ctx.save()
    ctx.globalAlpha = 0.2 + Math.sin(performance.now() / 500) * 0.1
    ctx.shadowColor = RARITY_COLORS[3]
    ctx.shadowBlur = 16 * scale
    ctx.drawImage(frame.sheet, frame.sx, frame.sy, frame.sw, frame.sh, drawX, drawY, drawW, drawH)
    ctx.restore()
  }

  // Selection outline (offscreen tinted copies drawn behind the sprite)
  if (this.id === selectedId) {
    var typeColor = TYPE_COLORS[this.species.type] || '#ffffff'
    if (!PokemonEntity._outlineCanvas) {
      PokemonEntity._outlineCanvas = document.createElement('canvas')
      PokemonEntity._outlineCtx = PokemonEntity._outlineCanvas.getContext('2d')
    }
    var oc = PokemonEntity._outlineCanvas
    var octx = PokemonEntity._outlineCtx
    oc.width = frame.sw + 2
    oc.height = frame.sh + 2
    // Draw sprite offset in 4 directions
    var offsets = [[-1,0],[1,0],[0,-1],[0,1]]
    for (var oi = 0; oi < offsets.length; oi++) {
      octx.drawImage(frame.sheet, frame.sx, frame.sy, frame.sw, frame.sh, 1 + offsets[oi][0], 1 + offsets[oi][1], frame.sw, frame.sh)
    }
    // Tint to type color
    octx.globalCompositeOperation = 'source-atop'
    octx.fillStyle = typeColor
    octx.fillRect(0, 0, oc.width, oc.height)
    // Cut out the original sprite shape
    octx.globalCompositeOperation = 'destination-out'
    octx.drawImage(frame.sheet, frame.sx, frame.sy, frame.sw, frame.sh, 1, 1, frame.sw, frame.sh)
    octx.globalCompositeOperation = 'source-over'
    // Draw outline behind sprite
    ctx.drawImage(oc, drawX - 1 * scale, drawY - 1 * scale, (frame.sw + 2) * scale, (frame.sh + 2) * scale)
  }

  // Draw main sprite
  ctx.drawImage(frame.sheet, frame.sx, frame.sy, frame.sw, frame.sh, drawX, drawY, drawW, drawH)

  // Rare sparkle effect
  if (this.species.rarity >= 2) {
    var time = performance.now()
    for (var si = 0; si < 4; si++) {
      var angle = (time / 1200 + si * 1.57) % (Math.PI * 2)
      var radius = 10 * scale
      var sparkX = screen.x + Math.cos(angle) * radius
      var sparkY = screen.y + Math.sin(angle) * radius - 6 * scale
      var sparkSize = (Math.sin(time / 250 + si * 1.3) * 0.5 + 1) * scale
      ctx.fillStyle = this.species.rarity >= 3 ? RARITY_COLORS[3] : '#fff'
      ctx.globalAlpha = Math.sin(time / 300 + si) * 0.3 + 0.7
      ctx.fillRect(sparkX - sparkSize / 2, sparkY - sparkSize / 2, sparkSize, sparkSize)
      // Cross sparkle
      ctx.fillRect(sparkX - sparkSize * 1.5 / 2, sparkY - sparkSize * 0.3 / 2, sparkSize * 1.5, sparkSize * 0.3)
      ctx.fillRect(sparkX - sparkSize * 0.3 / 2, sparkY - sparkSize * 1.5 / 2, sparkSize * 0.3, sparkSize * 1.5)
    }
    ctx.globalAlpha = 1.0
  }

  this.drawLabels(ctx, screen, scale)
}

PokemonEntity.prototype.drawLabels = function(ctx, screen, scale) {
  var lvFontSize = Math.max(6, Math.round(8 * camera.zoom / 3))
  var spriteTop = screen.y - 16 * scale

  // Username label
  if (this.username && this.username !== 'anonymous') {
    var baseFontSize = 24
    var textScale = lvFontSize / baseFontSize
    ctx.save()
    ctx.translate(screen.x, spriteTop - lvFontSize - 2)
    ctx.scale(textScale, textScale)
    ctx.font = baseFontSize + 'px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#fff'
    ctx.fillText('@' + this.username, 0, 0)
    ctx.restore()
  }

}

// Render Loop

function render() {
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, viewW(), viewH())
  ctx.fillStyle = '#0f1f0a'
  ctx.fillRect(0, 0, viewW(), viewH())

  var topLeft = worldToScreen(0, 0)
  ctx.drawImage(terrainCanvas, topLeft.x, topLeft.y, COLS * TILE * camera.zoom, ROWS * TILE * camera.zoom)

  var sorted = []
  pokemon.forEach(function(cr) { sorted.push(cr) })
  sorted.sort(function(a, b) { return a.y - b.y })
  for (var i = 0; i < sorted.length; i++) sorted[i].draw(ctx)
}

function gameLoop(timestamp) {
  var dt = timestamp - lastTime
  if (dt > 200) dt = 200
  lastTime = timestamp
  pokemon.forEach(function(cr) { cr.update(dt) })
  rebuildSpatialGrid()
  render()
  updateHoverCard()
  requestAnimationFrame(gameLoop)
}

// Pokemon Management

function createPokemon(sessionId, speciesIndex) {
  if (pokemon.has(sessionId)) return pokemon.get(sessionId)

  var idx = (typeof speciesIndex === 'number') ? speciesIndex : 0
  var sp = SPECIES[idx] || SPECIES[0]

  // Trigger sprite loading for this species
  SpriteManager.load(sp.dexNum)

  var nest = null
  for (var i = 0; i < NESTS.length; i++) {
    if (!NESTS[i].assigned) {
      nest = NESTS[i]
      nest.assigned = true
      break
    }
  }

  var spawnCol = 25, spawnRow = 10
  if (nest) {
    spawnCol = nest.col; spawnRow = nest.row
  } else {
    // Find a random walkable tile
    for (var si = 0; si < 50; si++) {
      var sc = Math.floor(Math.random() * COLS)
      var sr = Math.floor(Math.random() * ROWS)
      if (isWalkable(sc, sr)) { spawnCol = sc; spawnRow = sr; break }
    }
  }
  var cr = new PokemonEntity(sessionId, sp, spawnCol, spawnRow, nest)
  pokemon.set(sessionId, cr)
  updateEncounterCount()

  // Show toast for rare+ catches (only for new spawns)
  if (sp.rarity >= 2) {
    var who = cr.username || 'someone'
    showToast(who + ' caught a wild ' + sp.name + '!', RARITY_COLORS[sp.rarity])
  }

  return cr
}

function removePokemon(sessionId) {
  var cr = pokemon.get(sessionId)
  if (!cr) return
  cancelRemovalTimer(sessionId)
  if (cr.nest) cr.nest.assigned = false
  pokemon.delete(sessionId)
  if (selectedId === sessionId) selectedId = null
  updateEncounterCount()
}

function scheduleRemoval(sessionId) {
  cancelRemovalTimer(sessionId)
  removalTimers.set(sessionId, setTimeout(function() {
    removalTimers.delete(sessionId)
    removePokemon(sessionId)
  }, REMOVAL_DELAY))
}

function cancelRemovalTimer(sessionId) {
  var t = removalTimers.get(sessionId)
  if (t) { clearTimeout(t); removalTimers.delete(sessionId) }
}

// Utility

function randRange(min, max) {
  return min + Math.random() * (max - min)
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

// HTML escaping

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Collection state

var myCollection = {} // speciesId → count
var viewerUsername = ''

function initCollection() {
  // Check URL for viewer username
  var params = new URLSearchParams(location.search)
  viewerUsername = params.get('viewer') || ''
}

function updateCollectionFromServer(collections) {
  if (!collections) return
  if (viewerUsername && collections[viewerUsername]) {
    myCollection = collections[viewerUsername]
  } else {
    // Merge all collections for global view
    myCollection = {}
    for (var user in collections) {
      var coll = collections[user]
      for (var sid in coll) {
        myCollection[sid] = (myCollection[sid] || 0) + coll[sid]
      }
    }
  }
  updatePokedex()
  updateEncounterCount()
}

function addToCollection(speciesId) {
  myCollection[speciesId] = (myCollection[speciesId] || 0) + 1
  updatePokedex()
  updateEncounterCount()
}

// Pokédex UI

var pokedexCells = [] // cached cell references: { el, img, badge }

function initPokedex() {
  var grid = document.getElementById('pokedex-grid')
  if (!grid) return

  for (var i = 0; i < SPECIES.length; i++) {
    var sp = SPECIES[i]
    var cell = document.createElement('div')
    cell.className = 'pokedex-cell unseen'
    cell.title = '???'

    var img = document.createElement('img')
    img.src = '/assets/portraits/' + sp.dexNum + '.png'
    img.alt = '???'
    img.draggable = false

    var badge = document.createElement('span')
    badge.className = 'encounter-badge'

    cell.appendChild(img)
    cell.appendChild(badge)
    grid.appendChild(cell)
    pokedexCells.push({ el: cell, img: img, badge: badge })
  }
}

function updatePokedex() {
  var caught = 0
  for (var i = 0; i < SPECIES.length; i++) {
    var sp = SPECIES[i]
    var ref = pokedexCells[i]
    if (!ref) continue

    var count = myCollection[sp.id] || 0
    if (count > 0) {
      caught++
      ref.el.className = 'pokedex-cell caught'
      ref.el.title = sp.name + ' — ' + RARITY_NAMES[sp.rarity]
      ref.img.alt = sp.name
      ref.badge.textContent = count > 1 ? 'x' + count : ''
    } else {
      ref.el.className = 'pokedex-cell unseen'
      ref.el.title = '???'
      ref.img.alt = '???'
      ref.badge.textContent = ''
    }
  }

  var counter = document.getElementById('pokedex-counter')
  if (counter) counter.textContent = caught + '/' + SPECIES.length + ' CAUGHT'
}

// Toast notifications

function showToast(message, color) {
  var container = document.getElementById('toast-container')
  if (!container) return

  var toast = document.createElement('div')
  toast.className = 'toast'
  if (color) toast.style.borderLeftColor = color
  toast.textContent = message
  container.appendChild(toast)

  // Trigger animation
  requestAnimationFrame(function() { toast.classList.add('visible') })

  setTimeout(function() {
    toast.classList.add('fade-out')
    setTimeout(function() { toast.remove() }, 500)
  }, 4000)
}

// Hover Card

var hoverCardEl = null
var hoveredPokemonId = null
var hoverCardVisible = false
var lastMouseX = 0
var lastMouseY = 0

function initHoverCard() {
  hoverCardEl = document.getElementById('hover-card')
}

function showHoverCard(cr, screenX, screenY) {
  if (!hoverCardEl || !cr) return
  hoveredPokemonId = cr.id

  hoverCardVisible = true

  var typeColor = TYPE_COLORS[cr.species.type] || '#fff'
  var rarityName = RARITY_NAMES[cr.species.rarity]
  var rarityColor = RARITY_COLORS[cr.species.rarity]
  var safeName = escapeHtml((cr.username && cr.username !== 'anonymous') ? '@' + cr.username : 'anonymous')
  var safeSpecies = escapeHtml(cr.species.name)
  var safeStatus = escapeHtml(cr.statusText || 'idle')
  var activeClass = cr.isActive ? 'active' : 'inactive'

  var promptHtml = ''
  if (cr.prompt) {
    var truncated = cr.prompt.length > 80 ? cr.prompt.slice(0, 80) + '\u2026' : cr.prompt
    promptHtml = '<div class="hc-prompt">' + escapeHtml(truncated) + '</div>'
  }

  hoverCardEl.innerHTML =
    '<div class="hc-box">' +
      '<div class="hc-row">' +
        '<img class="hc-portrait" src="/assets/portraits/' + cr.dexNum + '.png" alt="' + safeSpecies + '">' +
        '<div class="hc-info">' +
          '<div class="hc-username">' + safeName + '</div>' +
          '<div class="hc-species-row">' +
            '<span class="hc-species" style="color:' + typeColor + '">' + safeSpecies + '</span>' +
            '<span class="hc-rarity" style="color:' + rarityColor + '">' + rarityName + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hc-divider"></div>' +
      '<div class="hc-status ' + activeClass + '">' +
        '<span class="hc-status-indicator ' + activeClass + '"></span>' +
        '<span>' + safeStatus + '</span>' +
      '</div>' +
      promptHtml +
    '</div>'

  hoverCardEl.classList.add('visible')
  cacheHoverCardSize()
  positionHoverCard(screenX, screenY)
}

var hoverCardCachedW = 200
var hoverCardCachedH = 160

function cacheHoverCardSize() {
  if (!hoverCardEl) return
  var w = hoverCardEl.offsetWidth
  var h = hoverCardEl.offsetHeight
  if (w > 0) hoverCardCachedW = w
  if (h > 0) hoverCardCachedH = h
}

function positionHoverCard(screenX, screenY) {
  if (!hoverCardEl) return
  // Scale offsets with zoom so the card stays clear of the sprite at any zoom level
  var zoomScale = Math.max(1, camera.zoom)
  var offsetX = 16 + 10 * zoomScale
  var offsetY = 8 + 12 * zoomScale
  var vw = window.innerWidth
  var vh = window.innerHeight

  var x = screenX + offsetX
  var y = screenY - offsetY - hoverCardCachedH

  // Flip left if overflows right
  if (x + hoverCardCachedW > vw - 8) x = screenX - offsetX - hoverCardCachedW
  if (x < 8) x = 8

  // Push down if overflows top
  if (y < 48) y = screenY + 24
  // Push up if overflows bottom
  if (y + hoverCardCachedH > vh - 8) y = vh - 8 - hoverCardCachedH

  hoverCardEl.style.left = x + 'px'
  hoverCardEl.style.top = y + 'px'
}

function hideHoverCard() {
  if (!hoverCardEl) return
  hoverCardEl.classList.remove('visible')
  hoveredPokemonId = null
  hoverCardVisible = false
}

function updateHoverCard() {
  if (!hoverCardVisible || !hoveredPokemonId) return
  if (!pokemon.has(hoveredPokemonId)) { hideHoverCard(); return }
  // Re-check if the pokemon is still under the cursor (it may have walked away)
  var rect = canvas.getBoundingClientRect()
  var sx = lastMouseX - rect.left
  var sy = lastMouseY - rect.top
  var hit = hitTestPokemon(sx, sy)
  if (!hit || hit.id !== hoveredPokemonId) hideHoverCard()
}

// DOM UI

function updateEncounterCount() {
  var caught = 0
  for (var k in myCollection) {
    if (myCollection[k] > 0) caught++
  }
  document.getElementById('encounter-count').textContent = caught + '/' + SPECIES.length + ' CAUGHT'
}

// WebSocket

var ws = null
var wsReconnectTimer = null

function connectWS() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  var world = new URLSearchParams(location.search).get('world') || 'global'
  ws = new WebSocket(proto + '//' + location.host + '/parties/world/' + world)

  ws.onopen = function() {
    document.getElementById('statusDot').className = 'status-dot connected'
    document.getElementById('statusText').textContent = 'connected'
  }

  ws.onmessage = function(e) {
    try {
      var m = JSON.parse(e.data)
      handleMsg(m)
    } catch (err) {}
  }

  ws.onclose = function() {
    document.getElementById('statusDot').className = 'status-dot'
    document.getElementById('statusText').textContent = 'disconnected'
    wsReconnectTimer = setTimeout(connectWS, 2000)
  }

  ws.onerror = function() {
    try { ws.close() } catch (err) {}
  }
}

function handleMsg(m) {
  if (!m || !m.type) return
  if (m.sessionId && endedSessions.has(m.sessionId) && m.type !== 'hook_session_end') return
  var cr

  switch (m.type) {
    case 'world_init':
      if (Array.isArray(m.agents)) {
        m.agents.forEach(function(a) {
          cr = pokemon.get(a.sessionId) || createPokemon(a.sessionId, a.speciesIndex)
          if (!cr) return
          if (a.username) cr.username = a.username
          cr.isActive = a.isActive
          cr.statusText = a.status || 'idle'
        })
      }
      if (m.collections) {
        updateCollectionFromServer(m.collections)
      }
      break

    case 'session_discovered':
      cr = createPokemon(m.sessionId, m.speciesIndex)
      if (cr) {
        if (m.username) cr.username = m.username
      }
      break

    case 'tool_start':
    case 'hook_tool_start':
      cancelRemovalTimer(m.sessionId)
      cr = pokemon.get(m.sessionId) || createPokemon(m.sessionId, m.speciesIndex)
      if (!cr) break
      if (m.username) cr.username = m.username
      cr.isActive = true
      cr.statusText = m.status || ('Using ' + (m.toolName || 'tool'))
      break

    case 'tool_done':
    case 'hook_tool_done':
      cr = pokemon.get(m.sessionId)
      if (cr) {
        cr.statusText = 'thinking\u2026'
      }
      break

    case 'agent_active':
      cancelRemovalTimer(m.sessionId)
      cr = pokemon.get(m.sessionId) || createPokemon(m.sessionId)
      if (!cr) break
      if (!cr.isActive) cr.statusText = 'alert!'
      cr.isActive = true
      break

    case 'new_turn':
    case 'hook_new_turn':
      cancelRemovalTimer(m.sessionId)
      cr = pokemon.get(m.sessionId) || createPokemon(m.sessionId)
      if (!cr) break
      cr.isActive = true
      cr.statusText = 'ready!'
      if (m.prompt) cr.prompt = m.prompt
      break

    case 'turn_end':
    case 'hook_stop':
      cr = pokemon.get(m.sessionId)
      if (cr) {
        cr.isActive = false
        cr.statusText = 'idle'
        cr.state = 'idle'
        cr.animFrame = 0
        cr.animTimer = 0
      }
      break

    case 'hook_notification':
      cancelRemovalTimer(m.sessionId)
      cr = pokemon.get(m.sessionId) || createPokemon(m.sessionId)
      if (!cr) break
      if (m.notificationType === 'permission_prompt') {
        cr.statusText = 'blocked!'
      } else if (m.notificationType === 'idle_prompt') {
        cr.statusText = 'waiting\u2026'
      }
      break

    case 'hook_subagent_start':
      var subId = m.sessionId + ':' + m.agentId
      cr = createPokemon(subId)
      if (cr) {
        cr.statusText = 'summoned!'
      }
      break

    case 'hook_subagent_stop':
      var subId2 = m.sessionId + ':' + m.agentId
      removePokemon(subId2)
      break

    case 'hook_session_start':
      endedSessions.delete(m.sessionId)
      cancelRemovalTimer(m.sessionId)
      if (m.replacesSessionId && pokemon.has(m.replacesSessionId)) {
        cr = pokemon.get(m.replacesSessionId)
        pokemon.delete(m.replacesSessionId)
        cr.id = m.sessionId
        pokemon.set(m.sessionId, cr)
        if (selectedId === m.replacesSessionId) selectedId = m.sessionId
      } else {
        cr = pokemon.get(m.sessionId) || createPokemon(m.sessionId, m.speciesIndex)
      }
      if (!cr) break
      if (m.username) cr.username = m.username
      cr.isActive = true
      cr.statusText = 'ready!'
      break

    case 'hook_session_clear':
      cr = pokemon.get(m.sessionId)
      if (cr) {
        cr.isActive = false
        cr.statusText = 'clearing\u2026'
      }
      break

    case 'hook_session_end':
      endedSessions.add(m.sessionId)
      removePokemon(m.sessionId)
      break

    case 'collection_update':
      if (m.collections) {
        updateCollectionFromServer(m.collections)
      }
      break
  }
}

// Init

initTileData()
initCanvas()
initInput()
initHoverCard()
initCollection()
initPokedex()

setTimeout(function() {
  fetch('/api/status')
    .then(function(r) { return r.json() })
    .then(function(data) {
      if (!data.hooksConfigured) {
        fetch('/api/hooks-config')
          .then(function(r) { return r.json() })
          .then(function(cfg) {
            document.getElementById('hooks-config-pre').textContent = JSON.stringify(cfg, null, 2)
            document.getElementById('setup-overlay').classList.add('visible')
          })
          .catch(function() {})
      }
    })
    .catch(function() {})
}, 500)

document.getElementById('copy-btn').addEventListener('click', function() {
  var text = document.getElementById('hooks-config-pre').textContent
  navigator.clipboard.writeText(text).then(function() {
    var btn = document.getElementById('copy-btn')
    btn.textContent = 'CAUGHT!'
    setTimeout(function() { btn.textContent = 'COPY' }, 2000)
  }).catch(function() {})
})

document.getElementById('close-setup').addEventListener('click', function() {
  document.getElementById('setup-overlay').classList.remove('visible')
})

updateEncounterCount()

loadTileset(function() {
  connectWS()
  lastTime = performance.now()
  requestAnimationFrame(gameLoop)
})
