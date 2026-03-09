// AGENTDEX — HTML Canvas Game Engine
// PMD-style sprite sheet (0025.png + 0025.json)
// Directions: 0=down, 1=down-right, 2=right, 3=up-right, 4=up, 5=up-left, 6=left, 7=down-left

var TILE = 16
var COLS = 24
var ROWS = 16
var WALK_SPEED = 38
var WANDER_PAUSE_MIN = 3000
var WANDER_PAUSE_MAX = 9000
var REMOVAL_DELAY = 30000

var DIR_TO_PMD = { down: 0, 'down-right': 1, right: 2, 'up-right': 3, up: 4, 'up-left': 5, left: 6, 'down-left': 7 }
var DIRS = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left']

var STATE_ANIM = { walk: 'Walk', idle: 'Idle', work: 'Pose', attack: 'Attack', shock: 'Shock', eat: 'Eat' }
var PERFORM_ACTIONS = ['attack', 'shock', 'eat', 'work']

var FPS_POKEMON_ANIMS = 36
// Per-frame durations in ticks at 36 FPS (from PMD sprite data)
var FRAME_DURATIONS = {
  Idle:    [40, 2, 3, 3, 3, 2],
  Walk:    [8, 10, 8, 10],
  Pose:    [8, 8, 8],
  Attack:  [2, 2, 6, 2, 2, 2, 2, 2, 2, 2],
  Shock:   [8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  Eat:     [10, 10, 10, 10],
  Hop:     [2, 1, 2, 3, 4, 4, 3, 2, 1, 2],
  Hurt:    [2, 8],
  Sleep:   [30, 35]
}
var PERFORM_DURATION_MIN = 1500
var PERFORM_DURATION_MAX = 3500

var SPECIES = [
  { name: 'Pikachu', type: 'electric' }
]

var TYPE_COLORS = {
  fire: '#f06030', water: '#3088d0', grass: '#40a030', electric: '#f0d020',
  psychic: '#9058c0', steel: '#8898a8', ground: '#a07848', dark: '#585060'
}

var NESTS = [
  { id: 'nest-0', col: 2, row: 2, dir: 'down', assigned: false },
  { id: 'nest-1', col: 4, row: 2, dir: 'down', assigned: false },
  { id: 'nest-2', col: 6, row: 2, dir: 'down', assigned: false },
  { id: 'nest-3', col: 3, row: 3, dir: 'down', assigned: false },
  { id: 'nest-4', col: 5, row: 3, dir: 'down', assigned: false },
  { id: 'nest-5', col: 2, row: 4, dir: 'right', assigned: false },
  { id: 'nest-6', col: 4, row: 4, dir: 'down', assigned: false },
  { id: 'nest-7', col: 6, row: 4, dir: 'left', assigned: false },
  { id: 'nest-8', col: 3, row: 5, dir: 'down', assigned: false },
  { id: 'nest-9', col: 5, row: 5, dir: 'down', assigned: false }
]

// Tile map

var tileData = []

function initTileData() {
  for (var r = 0; r < ROWS; r++) {
    tileData[r] = []
    for (var c = 0; c < COLS; c++) {
      tileData[r][c] = ((r + c) % 2 === 0) ? 1 : 2
    }
  }
}

// Pathfinding

function isWalkable(col, row) {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS
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

// Sprite Sheet

var spriteSheet = null
var spriteFrames = {}
var spriteAnims = {}    // { "Walk_Anim_0": [frame, ...] }
var shadowAnims = {}    // { "Walk_Shadow_0": [frame, ...] }
var spriteReady = false

function loadSpriteSheet(callback) {
  var img = new Image()
  img.onload = function() {
    spriteSheet = img
    fetch('/assets/0025.json')
      .then(function(r) { return r.json() })
      .then(function(data) {
        parseSpriteData(data)
        spriteReady = true
        if (callback) callback()
      })
  }
  img.src = '/assets/0025.png'
}

function parseSpriteData(data) {
  var frames = data.textures[0].frames

  for (var i = 0; i < frames.length; i++) {
    var f = frames[i]
    spriteFrames[f.filename] = {
      x: f.frame.x,
      y: f.frame.y,
      w: f.frame.w,
      h: f.frame.h,
      ox: f.spriteSourceSize.x,
      oy: f.spriteSourceSize.y,
      sw: f.sourceSize.w,
      sh: f.sourceSize.h
    }
  }

  // Build anim and shadow sequences
  var animMap = {}
  var shadowMap = {}
  for (var i = 0; i < frames.length; i++) {
    var fn = frames[i].filename
    var parts = fn.split('/')
    if (parts[0] !== 'Normal') continue
    var target = null
    if (parts[2] === 'Anim') target = animMap
    else if (parts[2] === 'Shadow') target = shadowMap
    else continue
    var key = parts[1] + '_' + parts[3]
    if (!target[key]) target[key] = []
    target[key].push({ num: parts[4], filename: fn })
  }

  function buildLookup(map) {
    var result = {}
    for (var key in map) {
      map[key].sort(function(a, b) { return a.num.localeCompare(b.num) })
      result[key] = map[key].map(function(e) { return spriteFrames[e.filename] })
    }
    return result
  }

  spriteAnims = buildLookup(animMap)
  shadowAnims = buildLookup(shadowMap)
}

function getSpriteFrames(state, dir) {
  var animName = STATE_ANIM[state] || 'Idle'
  var pmdDir = DIR_TO_PMD[dir]
  if (pmdDir === undefined) pmdDir = 0
  var key = animName + '_' + pmdDir
  return {
    anim: spriteAnims[key] || spriteAnims['Idle_0'] || [],
    shadow: shadowAnims[key] || shadowAnims['Idle_0'] || [],
    durations: FRAME_DURATIONS[animName] || FRAME_DURATIONS['Idle']
  }
}

// Camera

var camera = { x: 0, y: 0, zoom: 3, minZoom: 1, maxZoom: 6 }

function worldToScreen(wx, wy) {
  var cx = canvas.width / 2
  var cy = canvas.height / 2
  return {
    x: (wx - camera.x) * camera.zoom + cx,
    y: (wy - camera.y) * camera.zoom + cy
  }
}

function screenToWorld(sx, sy) {
  var cx = canvas.width / 2
  var cy = canvas.height / 2
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
  canvas.style.imageRendering = 'crisp-edges'
  container.appendChild(canvas)
  ctx = canvas.getContext('2d')

  terrainCanvas = document.createElement('canvas')
  terrainCanvas.width = COLS * TILE
  terrainCanvas.height = ROWS * TILE
  terrainCtx = terrainCanvas.getContext('2d')

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  camera.x = (COLS * TILE) / 2
  camera.y = (ROWS * TILE) / 2
}

function resizeCanvas() {
  var container = document.getElementById('game-container')
  canvas.width = container.clientWidth
  canvas.height = container.clientHeight
  ctx.imageSmoothingEnabled = false
  drawStaticTerrain()
}

// Input

var dragState = { dragging: false, moved: false, lastX: 0, lastY: 0, target: null }

function hitTestCreature(sx, sy) {
  var world = screenToWorld(sx, sy)
  var hit = null
  var minDist = TILE * 1.5
  creatures.forEach(function(cr) {
    var dx = world.x - cr.x
    var dy = world.y - cr.y
    var dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < minDist) {
      minDist = dist
      hit = cr
    }
  })
  return hit
}

function initInput() {
  canvas.addEventListener('pointerdown', function(e) {
    var rect = canvas.getBoundingClientRect()
    var sx = e.clientX - rect.left
    var sy = e.clientY - rect.top
    var hit = hitTestCreature(sx, sy)

    dragState.dragging = true
    dragState.moved = false
    dragState.lastX = e.clientX
    dragState.lastY = e.clientY
    dragState.target = hit

    if (hit) {
      selectedId = hit.id
      updatePartyBar()
      canvas.style.cursor = "url('/assets/cursor-grabbing.png') 12 12, grabbing"
    }
  })

  window.addEventListener('pointermove', function(e) {
    if (!dragState.dragging) return
    var dx = e.clientX - dragState.lastX
    var dy = e.clientY - dragState.lastY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true

    if (dragState.target) {
      // Drag creature
      var cr = dragState.target
      cr.x += dx / camera.zoom
      cr.y += dy / camera.zoom
      cr.col = Math.round((cr.x - TILE / 2) / TILE)
      cr.row = Math.round((cr.y - TILE / 2) / TILE)
    } else {
      // Pan camera
      camera.x -= dx / camera.zoom
      camera.y -= dy / camera.zoom
    }

    dragState.lastX = e.clientX
    dragState.lastY = e.clientY
  })

  window.addEventListener('pointerup', function(e) {
    if (dragState.target) {
      // Snap creature to grid on drop
      var cr = dragState.target
      cr.col = Math.max(0, Math.min(COLS - 1, Math.round((cr.x - TILE / 2) / TILE)))
      cr.row = Math.max(0, Math.min(ROWS - 1, Math.round((cr.y - TILE / 2) / TILE)))
      cr.x = cr.col * TILE + TILE / 2
      cr.y = cr.row * TILE + TILE / 2
      // Resume wandering from new position
      cr.path = []
      cr.state = 'idle'
      cr.animFrame = 0
      cr.animTimer = 0
      cr.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
      canvas.style.cursor = "url('/assets/cursor-grab.png') 12 12, grab"
    } else if (!dragState.moved && dragState.dragging) {
      var rect = canvas.getBoundingClientRect()
      handleClick(e.clientX - rect.left, e.clientY - rect.top)
    }
    dragState.dragging = false
    dragState.target = null
  })

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault()
    var delta = e.deltaY > 0 ? -0.25 : 0.25
    camera.zoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom + delta))
  }, { passive: false })

  document.getElementById('zoomIn').addEventListener('click', function() {
    camera.zoom = Math.min(camera.maxZoom, camera.zoom + 0.5)
  })
  document.getElementById('zoomOut').addEventListener('click', function() {
    camera.zoom = Math.max(camera.minZoom, camera.zoom - 0.5)
  })
}

function handleClick(sx, sy) {
  var world = screenToWorld(sx, sy)
  var hit = null
  var minDist = TILE * 2

  creatures.forEach(function(cr) {
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
    updatePartyBar()
  }
}

// Terrain

function drawStaticTerrain() {
  var g = terrainCtx
  g.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height)

  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      g.fillStyle = (tileData[r][c] === 1) ? '#2d5a1e' : '#275018'
      g.fillRect(c * TILE, r * TILE, TILE, TILE)
    }
  }
}

// Creature Entity

var creatures = new Map()
var removalTimers = new Map()
var endedSessions = new Set()
var selectedId = null

function CreatureEntity(sessionId, species, startCol, startRow, nestRef) {
  this.id = sessionId
  this.species = species
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
  this.xp = 0
  this.level = 1
  this.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
  this.performTimer = 0
  this.bubbleType = null
  this.bubbleTimer = 0
  this.animFrame = 0
  this.animTimer = 0
}

CreatureEntity.prototype.getAnimData = function() {
  return getSpriteFrames(this.state, this.dir)
}

CreatureEntity.prototype.getFrameDurationMs = function(durations, frameIndex) {
  if (!durations || durations.length === 0) return 200
  var ticks = durations[frameIndex % durations.length] || 1
  return ticks * (1000 / FPS_POKEMON_ANIMS)
}

CreatureEntity.prototype.update = function(dt) {
  // Per-frame duration animation
  var data = this.getAnimData()
  this.animTimer += dt
  var frameDur = this.getFrameDurationMs(data.durations, this.animFrame)
  if (this.animTimer >= frameDur) {
    this.animTimer -= frameDur
    if (data.anim.length > 0) {
      this.animFrame = (this.animFrame + 1) % data.anim.length
    }
  }

  if (this.bubbleTimer > 0) {
    this.bubbleTimer -= dt
    if (this.bubbleTimer <= 0) this.bubbleType = null
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
      if (Math.random() < 0.4) {
        var action = PERFORM_ACTIONS[Math.floor(Math.random() * PERFORM_ACTIONS.length)]
        this.state = action
        this.animFrame = 0
        this.animTimer = 0
        this.performTimer = randRange(PERFORM_DURATION_MIN, PERFORM_DURATION_MAX)
        this.dir = DIRS[Math.floor(Math.random() * DIRS.length)]
      } else {
        for (var att = 0; att < 20; att++) {
          var rc = 1 + Math.floor(Math.random() * (COLS - 2))
          var rr = 1 + Math.floor(Math.random() * (ROWS - 2))
          if (isWalkable(rc, rr)) {
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
    this.moveProgress += (WALK_SPEED / TILE) * (dt / 1000)
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

CreatureEntity.prototype.finishWalk = function() {
  this.state = 'idle'
  this.wanderTimer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX)
  this.animFrame = 0
  this.animTimer = 0
}

CreatureEntity.prototype.draw = function(ctx) {
  if (!spriteReady) return

  var data = this.getAnimData()
  if (data.anim.length === 0) return

  var frameIdx = this.animFrame % data.anim.length
  var frame = data.anim[frameIdx]
  var screen = worldToScreen(this.x, this.y)
  var scale = camera.zoom * 0.55

  // Center-anchor on sourceSize
  var cx = screen.x - (frame.sw / 2) * scale
  var cy = screen.y - (frame.sh / 2) * scale

  // Draw shadow from sprite sheet
  if (data.shadow.length > 0) {
    var sf = data.shadow[frameIdx % data.shadow.length]
    var scx = screen.x - (sf.sw / 2) * scale
    var scy = screen.y - (sf.sh / 2) * scale

    ctx.drawImage(
      spriteSheet,
      sf.x, sf.y, sf.w, sf.h,
      scx + sf.ox * scale, scy + sf.oy * scale,
      sf.w * scale, sf.h * scale
    )
  }

  // Draw sprite (with selection outline + tint if selected)
  var drawX = cx + frame.ox * scale
  var drawY = cy + frame.oy * scale
  var drawW = frame.w * scale
  var drawH = frame.h * scale

  if (this.id === selectedId) {
    var typeColor = TYPE_COLORS[this.species.type] || '#ffffff'
    if (!CreatureEntity._selCanvas) {
      CreatureEntity._selCanvas = document.createElement('canvas')
      CreatureEntity._selCtx = CreatureEntity._selCanvas.getContext('2d')
    }
    var sc2 = CreatureEntity._selCanvas
    var sctx = CreatureEntity._selCtx
    var pw = Math.ceil(frame.w) + 4
    var ph = Math.ceil(frame.h) + 4
    sc2.width = pw
    sc2.height = ph
    sctx.clearRect(0, 0, pw, ph)
    sctx.drawImage(spriteSheet, frame.x, frame.y, frame.w, frame.h, 2, 2, frame.w, frame.h)

    // Outline: draw the sprite offset in 4 directions, then composite the color
    sctx.globalCompositeOperation = 'source-over'
    if (!CreatureEntity._outlineCanvas) {
      CreatureEntity._outlineCanvas = document.createElement('canvas')
      CreatureEntity._outlineCtx = CreatureEntity._outlineCanvas.getContext('2d')
    }
    var outlineCanvas = CreatureEntity._outlineCanvas
    var octx = CreatureEntity._outlineCtx
    outlineCanvas.width = pw
    outlineCanvas.height = ph
    var offsets = [[-1,0],[1,0],[0,-1],[0,1]]
    for (var oi = 0; oi < offsets.length; oi++) {
      octx.drawImage(spriteSheet, frame.x, frame.y, frame.w, frame.h, 2 + offsets[oi][0], 2 + offsets[oi][1], frame.w, frame.h)
    }
    // Color the outline
    octx.globalCompositeOperation = 'source-atop'
    octx.fillStyle = typeColor
    octx.fillRect(0, 0, pw, ph)
    octx.globalCompositeOperation = 'destination-out'
    octx.drawImage(spriteSheet, frame.x, frame.y, frame.w, frame.h, 2, 2, frame.w, frame.h)

    // Draw outline behind sprite
    ctx.drawImage(outlineCanvas, drawX - 2 * scale, drawY - 2 * scale, pw * scale, ph * scale)

    // Draw sprite with slight tint overlay
    ctx.drawImage(spriteSheet, frame.x, frame.y, frame.w, frame.h, drawX, drawY, drawW, drawH)
    ctx.save()
    ctx.globalAlpha = 0.15
    sctx.clearRect(0, 0, pw, ph)
    sctx.drawImage(spriteSheet, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h)
    sctx.globalCompositeOperation = 'source-atop'
    sctx.fillStyle = typeColor
    sctx.fillRect(0, 0, frame.w, frame.h)
    sctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(sc2, 0, 0, frame.w, frame.h, drawX, drawY, drawW, drawH)
    ctx.restore()
  } else {
    ctx.drawImage(spriteSheet, frame.x, frame.y, frame.w, frame.h, drawX, drawY, drawW, drawH)
  }

  var lvFontSize = Math.max(5, Math.round(6 * camera.zoom / 3))
  var spriteTop = screen.y - 16 * scale

  if (this.isActive && this.state === 'work' && this.statusText) {
    ctx.font = lvFontSize + 'px Silkscreen, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    var tw = ctx.measureText(this.statusText).width + 8
    var th = lvFontSize + 6
    var bx = screen.x - tw / 2
    var by = spriteTop - th
    ctx.fillStyle = 'rgba(15,31,10,0.85)'
    ctx.fillRect(bx, by, tw, th)
    ctx.fillStyle = '#48d848'
    ctx.fillText(this.statusText, screen.x, by + th / 2)
    ctx.textBaseline = 'alphabetic'
  }

  if (this.bubbleType && this.bubbleTimer > 0) {
    var bbx = screen.x + 6 * scale
    var bby = spriteTop - 4
    var br = 6 * camera.zoom / 3
    ctx.fillStyle = this.bubbleType === 'alert' ? '#f85848' : '#f0c040'
    ctx.beginPath()
    ctx.arc(bbx, bby, br, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold ' + Math.round(br * 1.3) + 'px "Press Start 2P", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.bubbleType === 'alert' ? '!' : '?', bbx, bby)
    ctx.textBaseline = 'alphabetic'
  }
}

// Render Loop

function render() {
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#0f1f0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  var topLeft = worldToScreen(0, 0)
  ctx.drawImage(terrainCanvas, topLeft.x, topLeft.y, COLS * TILE * camera.zoom, ROWS * TILE * camera.zoom)

  var sorted = []
  creatures.forEach(function(cr) { sorted.push(cr) })
  sorted.sort(function(a, b) { return a.y - b.y })
  for (var i = 0; i < sorted.length; i++) sorted[i].draw(ctx)
}

function gameLoop(timestamp) {
  var dt = timestamp - lastTime
  if (dt > 200) dt = 200
  lastTime = timestamp
  creatures.forEach(function(cr) { cr.update(dt) })
  render()
  requestAnimationFrame(gameLoop)
}

// Creature Management

function createCreature(sessionId, speciesIndex) {
  if (creatures.has(sessionId)) return creatures.get(sessionId)

  var idx = (typeof speciesIndex === 'number') ? speciesIndex : 0
  var sp = SPECIES[idx % SPECIES.length]

  var nest = null
  for (var i = 0; i < NESTS.length; i++) {
    if (!NESTS[i].assigned) {
      nest = NESTS[i]
      nest.assigned = true
      break
    }
  }

  var cr = new CreatureEntity(sessionId, sp, nest ? nest.col : 12, nest ? nest.row : 8, nest)
  creatures.set(sessionId, cr)
  updatePartyBar()
  updateEncounterCount()
  return cr
}

function removeCreature(sessionId) {
  var cr = creatures.get(sessionId)
  if (!cr) return
  cancelRemovalTimer(sessionId)
  if (cr.nest) cr.nest.assigned = false
  creatures.delete(sessionId)
  if (selectedId === sessionId) selectedId = null
  updatePartyBar()
  updateEncounterCount()
}

function scheduleRemoval(sessionId) {
  cancelRemovalTimer(sessionId)
  removalTimers.set(sessionId, setTimeout(function() {
    removalTimers.delete(sessionId)
    removeCreature(sessionId)
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

// DOM UI

function updatePartyBar() {
  var bar = document.getElementById('party-bar')
  bar.innerHTML = ''

  creatures.forEach(function(cr) {
    var div = document.createElement('div')
    div.className = 'party-member' + (cr.id === selectedId ? ' selected' : '')
    div.onclick = function() {
      selectedId = cr.id
      camera.x = cr.x
      camera.y = cr.y
      updatePartyBar()
    }

    var dot = document.createElement('div')
    dot.className = 'party-dot'
    dot.style.background = TYPE_COLORS[cr.species.type] || '#888'
    div.appendChild(dot)

    var info = document.createElement('div')
    info.className = 'party-info'

    var name = document.createElement('div')
    name.className = 'party-name'
    name.style.color = TYPE_COLORS[cr.species.type] || '#fff'
    name.textContent = cr.species.name
    info.appendChild(name)

    var level = document.createElement('div')
    level.className = 'party-level'
    level.textContent = 'Lv' + cr.level
    info.appendChild(level)

    var hpWrap = document.createElement('div')
    hpWrap.className = 'party-hp'
    var hpFill = document.createElement('div')
    hpFill.className = 'party-hp-fill'
    var hpPct = cr.isActive ? (75 + Math.random() * 25) : (30 + Math.random() * 25)
    hpFill.style.width = hpPct + '%'
    hpFill.style.background = hpPct > 50 ? 'var(--hp-green)' : hpPct > 25 ? 'var(--hp-yellow)' : 'var(--hp-red)'
    hpWrap.appendChild(hpFill)
    info.appendChild(hpWrap)

    var status = document.createElement('div')
    status.className = 'party-status'
    status.textContent = cr.statusText || ''
    info.appendChild(status)

    div.appendChild(info)
    bar.appendChild(div)
  })
}

function updateEncounterCount() {
  document.getElementById('encounter-count').textContent = 'WILD ' + creatures.size + ' FOUND'
}

// WebSocket

var ws = null
var wsReconnectTimer = null

function connectWS() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(proto + '//' + location.host)

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
    case 'session_discovered':
      cr = createCreature(m.sessionId, m.speciesIndex)
      if (cr && typeof m.xp === 'number' && m.xp > cr.xp) {
        cr.xp = m.xp
        cr.level = Math.min(100, 1 + Math.floor(cr.xp / 5))
        updatePartyBar()
      }
      break

    case 'tool_start':
    case 'hook_tool_start':
      cancelRemovalTimer(m.sessionId)
      cr = creatures.get(m.sessionId) || createCreature(m.sessionId, m.speciesIndex)
      if (!cr) break
      cr.isActive = true
      cr.statusText = m.status || ('Using ' + (m.toolName || 'tool'))
      if (typeof m.xp === 'number') { cr.xp = m.xp } else { cr.xp++ }
      cr.level = Math.min(100, 1 + Math.floor(cr.xp / 5))
      updatePartyBar()
      break

    case 'tool_done':
    case 'hook_tool_done':
      cr = creatures.get(m.sessionId)
      if (cr) {
        cr.statusText = 'thinking\u2026'
        updatePartyBar()
      }
      break

    case 'agent_active':
      cancelRemovalTimer(m.sessionId)
      cr = creatures.get(m.sessionId) || createCreature(m.sessionId)
      if (!cr) break
      if (!cr.isActive) cr.statusText = 'alert!'
      cr.isActive = true
      updatePartyBar()
      break

    case 'new_turn':
    case 'hook_new_turn':
      cancelRemovalTimer(m.sessionId)
      cr = creatures.get(m.sessionId) || createCreature(m.sessionId)
      if (!cr) break
      cr.isActive = true
      cr.statusText = 'ready!'
      cr.bubbleType = null
      cr.bubbleTimer = 0
      updatePartyBar()
      break

    case 'turn_end':
    case 'hook_stop':
      cr = creatures.get(m.sessionId)
      if (cr) {
        cr.isActive = false
        cr.statusText = 'idle'
        cr.state = 'idle'
        cr.animFrame = 0
        cr.animTimer = 0
        updatePartyBar()
      }
      break

    case 'hook_notification':
      cancelRemovalTimer(m.sessionId)
      cr = creatures.get(m.sessionId) || createCreature(m.sessionId)
      if (!cr) break
      if (m.notificationType === 'permission_prompt') {
        cr.bubbleType = 'alert'
        cr.bubbleTimer = 30000
        cr.statusText = 'blocked!'
      } else if (m.notificationType === 'idle_prompt') {
        cr.bubbleType = 'question'
        cr.bubbleTimer = 5000
        cr.statusText = 'waiting\u2026'
      }
      updatePartyBar()
      break

    case 'hook_subagent_start':
      var subId = m.sessionId + ':' + m.agentId
      cr = createCreature(subId)
      if (cr) {
        cr.statusText = 'summoned!'
        updatePartyBar()
      }
      break

    case 'hook_subagent_stop':
      var subId2 = m.sessionId + ':' + m.agentId
      removeCreature(subId2)
      break

    case 'hook_session_start':
      endedSessions.delete(m.sessionId)
      cancelRemovalTimer(m.sessionId)
      if (m.replacesSessionId && creatures.has(m.replacesSessionId)) {
        cr = creatures.get(m.replacesSessionId)
        creatures.delete(m.replacesSessionId)
        cr.id = m.sessionId
        creatures.set(m.sessionId, cr)
        if (selectedId === m.replacesSessionId) selectedId = m.sessionId
      } else {
        cr = creatures.get(m.sessionId) || createCreature(m.sessionId, m.speciesIndex)
      }
      if (!cr) break
      cr.isActive = true
      cr.statusText = 'ready!'
      if (typeof m.xp === 'number' && m.xp > cr.xp) {
        cr.xp = m.xp
        cr.level = Math.min(100, 1 + Math.floor(cr.xp / 5))
      }
      updatePartyBar()
      break

    case 'hook_session_clear':
      cr = creatures.get(m.sessionId)
      if (cr) {
        cr.isActive = false
        cr.statusText = 'clearing\u2026'
        updatePartyBar()
      }
      break

    case 'hook_session_end':
      endedSessions.add(m.sessionId)
      removeCreature(m.sessionId)
      break
  }
}

// Init

initTileData()
initCanvas()
initInput()

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

loadSpriteSheet(function() {
  connectWS()
  lastTime = performance.now()
  requestAnimationFrame(gameLoop)
})
