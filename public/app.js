/* Zeus / Navico MFD: ES5, XHR, no fetch/async/await. */
var TOKEN_KEY = 'skDeviceToken'
var CLIENT_KEY = 'skChainClientId'
var HREF_KEY = 'skChainHref'
var POSTED_KEY = 'skChainPosted'
var DEFAULT_CHAIN = 'winches.windlass.rode'
var DEFAULT_DEPTH = 'environment.depth.belowkeel'

var connected = false
var ws
var wsNr = 0
var reconnectTimer = null

var depth = 0
var chain = 0
var depthPath = DEFAULT_DEPTH
var chainPath = DEFAULT_CHAIN

var authToken = ''
var loggedIn = false
var authRequired = true
var devicePending = false
var pollTimer = null
var pollHref = ''
var deadHrefs = {}
var postInFlight = false
var postedOnce = false
var memoryClientId = ''
var memoryHref = ''

var noSleep = new NoSleep()
var wakeLockEnabled = false

try {
  authToken = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem('skAuthToken') || ''
  postedOnce = localStorage.getItem(POSTED_KEY) === '1'
} catch (e) {}

function el (id) { return document.getElementById(id) }

function uuid () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0
    var v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

function storageGet (key) {
  try { return localStorage.getItem(key) || '' } catch (e) { return '' }
}

function storageSet (key, value) {
  try { localStorage.setItem(key, value) } catch (e) {}
}

function storageDel (key) {
  try { localStorage.removeItem(key) } catch (e) {}
}

function markPosted () {
  postedOnce = true
  storageSet(POSTED_KEY, '1')
}

function clearPosted () {
  postedOnce = false
  storageDel(POSTED_KEY)
}

function getClientId () {
  if (memoryClientId) return memoryClientId
  var id = storageGet(CLIENT_KEY)
  if (!id) id = uuid()
  memoryClientId = id
  storageSet(CLIENT_KEY, id)
  return memoryClientId
}

function saveToken (token) {
  authToken = token || ''
  if (authToken) {
    storageSet(TOKEN_KEY, authToken)
    try { sessionStorage.setItem('skAuthToken', authToken) } catch (e) {}
  } else {
    storageDel(TOKEN_KEY)
    try { sessionStorage.removeItem('skAuthToken') } catch (e) {}
  }
}

function http (opts, cb) {
  var xhr = new XMLHttpRequest()
  xhr.open(opts.method || 'GET', opts.url, true)
  xhr.withCredentials = opts.credentials !== false
  if (opts.body) xhr.setRequestHeader('Content-Type', 'application/json')
  if (opts.auth !== false && authToken) xhr.setRequestHeader('Authorization', 'Bearer ' + authToken)
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return
    var data = {}
    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {} } catch (err) {
      data = { error: xhr.responseText }
    }
    cb(xhr.status, data)
  }
  xhr.send(opts.body ? JSON.stringify(opts.body) : null)
}

function setStatus (msg, isError) {
  var line = el('statusLine')
  if (!line) return
  line.textContent = msg || ''
  line.className = isError ? 'meta error' : 'meta'
  fitLayout()
}

function setHidden (node, hide) {
  if (!node) return
  if (hide) node.className = (node.className || '').replace(/\bis-hidden\b/g, '') + ' is-hidden'
  else node.className = (node.className || '').replace(/\bis-hidden\b/g, '').replace(/\s+/g, ' ').replace(/^\s|\s$/g, '')
  fitLayout()
}

function renderPending () {
  setHidden(el('devicePending'), !devicePending)
}

function httpError (status, data, url) {
  if (status === 401) {
    loggedIn = false
    saveToken('')
    renderPending()
    return new Error('Approve this device in Signal K')
  }
  return new Error((data && (data.error || data.message)) || (status + ' ' + url))
}

function stopDevicePoll () {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function deviceRequestGone (status, data) {
  if (status === 404) return true
  if (status !== 500) return false
  var msg = ''
  if (data) {
    if (data.error) msg = String(data.error)
    else if (data.message) msg = String(data.message)
  }
  return msg.indexOf('not found') !== -1 || msg.indexOf('Unable to check request') !== -1
}

function applyLogin (token) {
  if (token) saveToken(token)
  loggedIn = true
  devicePending = false
  stopDevicePoll()
  storageDel(HREF_KEY)
  renderPending()
  setStatus('')
}

function pollDeviceHref (href) {
  http({ method: 'GET', url: href, auth: false, credentials: false }, function (status, data) {
    if (deviceRequestGone(status, data)) {
      deadHrefs[href] = true
      stopDevicePoll()
      if (memoryHref === href) memoryHref = ''
      if (pollHref === href) pollHref = ''
      storageDel(HREF_KEY)
      if (!authToken) clearPosted()
      devicePending = true
      renderPending()
      setStatus('Approve this device in Signal K → Security → Access Requests')
      return
    }
    var ar = data && data.accessRequest
    if (ar && ar.permission === 'APPROVED' && ar.token) {
      applyLogin(ar.token)
      return
    }
    if (ar && ar.permission === 'DENIED') {
      devicePending = false
      clearPosted()
      setStatus('Device access was denied', true)
      renderPending()
      stopDevicePoll()
    }
  })
}

function startHrefPoll (href) {
  if (!href || deadHrefs[href]) return
  pollHref = href
  memoryHref = href
  storageSet(HREF_KEY, href)
  if (!pollTimer) {
    pollTimer = setInterval(function () { pollDeviceHref(pollHref) }, 3000)
  }
  pollDeviceHref(href)
}

function submitDeviceRequest () {
  if (postInFlight || loggedIn) return
  postInFlight = true
  markPosted()
  var body = {
    clientId: getClientId(),
    description: 'Chain and Depth',
    permissions: 'readwrite'
  }
  http({ method: 'POST', url: '/signalk/v1/access/requests', body: body, auth: false, credentials: false }, function (status, data) {
    postInFlight = false
    if (data && data.token) {
      applyLogin(data.token)
      return
    }
    var already = data && data.message && String(data.message).indexOf('already requested') !== -1
    if (status === 400 && already) {
      devicePending = true
      renderPending()
      setStatus('Approve this device in Signal K → Security → Access Requests')
      var keep = memoryHref || storageGet(HREF_KEY)
      if (keep && !deadHrefs[keep]) startHrefPoll(keep)
      return
    }
    if (status === 202 && data && data.href) {
      startHrefPoll(data.href)
      devicePending = true
      renderPending()
      setStatus('Approve this device in Signal K → Security → Access Requests')
      return
    }
    var href = memoryHref || storageGet(HREF_KEY)
    if (href && !deadHrefs[href]) {
      devicePending = true
      renderPending()
      setStatus('Approve this device in Signal K → Security → Access Requests')
      startHrefPoll(href)
      return
    }
    if (status === 404) {
      renderPending()
      return
    }
    devicePending = true
    renderPending()
    setStatus('Waiting for device approval in Signal K')
  })
}

function startDeviceRequest () {
  if (!authRequired || loggedIn || postInFlight) return
  var href = memoryHref || storageGet(HREF_KEY)
  if (href && !deadHrefs[href]) {
    devicePending = true
    renderPending()
    setStatus('Approve this device in Signal K → Security → Access Requests')
    startHrefPoll(href)
    return
  }
  if (postedOnce) {
    devicePending = true
    renderPending()
    setStatus('Approve this device in Signal K → Security → Access Requests')
    return
  }
  submitDeviceRequest()
}

function checkLogin (cb) {
  http({ method: 'GET', url: '/skServer/loginStatus' }, function (status, data) {
    if (status >= 200 && status < 300) {
      authRequired = data.authenticationRequired !== false
      loggedIn = data.status === 'loggedIn' || !!authToken
    } else {
      authRequired = true
      loggedIn = !!authToken
    }
    if (cb) cb()
  })
}

function applyOptions (json) {
  if (json && json.chain) chainPath = json.chain
  if (json && json.depth) depthPath = json.depth
}

function loadOptions (cb) {
  http({ method: 'GET', url: '/signalk/v1/api/signalk-chain-plugin/options', auth: false }, function (status, data) {
    if (status >= 200 && status < 300 && data) {
      applyOptions(data)
      return cb()
    }
    http({ method: 'GET', url: '/plugins/signalk-chain-plugin/options' }, function (status2, data2) {
      if (status2 >= 200 && status2 < 300 && data2) applyOptions(data2)
      cb()
    })
  })
}

function putUrl (path) {
  return '/signalk/v1/api/vessels/self/' + String(path || '').split('.').join('/')
}

function resetCounter (cb) {
  http({ method: 'PUT', url: putUrl(chainPath), body: { value: 0 } }, function (status, data) {
    if (status === 401) {
      loggedIn = false
      saveToken('')
      startDeviceRequest()
      return cb(new Error('Approve this device in Signal K'))
    }
    if (status < 200 || status >= 300) return cb(httpError(status, data, putUrl(chainPath)))
    cb(null)
  })
}

function scheduleReconnect () {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null
    connect()
  }, 1000)
}

function connect () {
  if (connected || wsNr >= 1) return
  ws = new WebSocket((window.location.protocol === 'https:' ? 'wss' : 'ws') + '://' + window.location.host + '/signalk/v1/stream?subscribe=none')
  ws.onopen = function () {
    wsNr++
    connected = true
    setListeningStations()
    ws.onmessage = function (event) {
      if (event.data.indexOf('signalk-server') !== -1) {
        console.log('Skipping welcome message: ' + event.data)
      } else {
        try { handleData(JSON.parse(event.data)) } catch (e) {}
      }
    }
    ws.onclose = function () {
      connected = false
      wsNr--
      console.log('WebSocket closed - wsNr: ' + wsNr)
      scheduleReconnect()
    }
    ws.onerror = function () {
      ws.close()
    }
  }
}

function setListeningStations () {
  var paths = [{ path: chainPath }, { path: depthPath }]
  var subscriptionMessage = JSON.stringify({
    context: 'vessels.self',
    subscribe: paths
  })
  console.log('subscriptionMessage: ' + subscriptionMessage)
  if (ws && ws.readyState === 1) ws.send(subscriptionMessage)
}

function handleData (data) {
  if (!data || !data.updates || !data.updates[0] || !data.updates[0].values) return
  var values = data.updates[0].values
  var i, path, value
  for (i = 0; i < values.length; i++) {
    path = values[i].path
    value = values[i].value
    if (typeof value !== 'number') continue
    if (path === depthPath) depth = value.toFixed(1)
    else if (path === chainPath) chain = value.toFixed(1)
  }
  el('depth').innerHTML = depth
  el('chain').innerHTML = chain
  fitLayout()
}

var toggleEl = el('toggle')
toggleEl.addEventListener('click', function () {
  if (!wakeLockEnabled) {
    noSleep.enable()
    wakeLockEnabled = true
    toggleEl.className = 'key on'
  } else {
    noSleep.disable()
    wakeLockEnabled = false
    toggleEl.className = 'key'
  }
}, false)

var SLIDER_PAD = 4
var SLIDER_DONE = 0.9
var sliderDrag = false
var sliderBusy = false
var sliderX = 0
var sliderMax = 1
var sliderGrab = 0
var sliderStartX = 0

function pageX (e) {
  if (e.touches && e.touches.length) return e.touches[0].clientX
  if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientX
  return e.clientX
}

function measureSlider () {
  var track = el('resetSlider')
  var thumb = el('resetThumb')
  if (!track || !thumb) return
  sliderMax = track.clientWidth - thumb.offsetWidth - SLIDER_PAD * 2
  if (sliderMax < 1) sliderMax = 1
}

function paintSlider () {
  var thumb = el('resetThumb')
  var fill = el('resetFill')
  var track = el('resetSlider')
  var x = SLIDER_PAD + sliderX
  var half
  if (thumb) thumb.style.left = x + 'px'
  half = thumb && thumb.offsetWidth ? Math.floor(thumb.offsetWidth / 2) : 32
  if (fill) fill.style.width = (x + half) + 'px'
  if (track) track.setAttribute('aria-valuenow', String(Math.round((sliderX / sliderMax) * 100)))
}

function sliderThumbTransition (on) {
  var thumb = el('resetThumb')
  var fill = el('resetFill')
  var t = on ? 'left 160ms ease' : 'none'
  var ft = on ? 'width 160ms ease' : 'none'
  if (thumb) {
    thumb.style.webkitTransition = t
    thumb.style.transition = t
  }
  if (fill) {
    fill.style.webkitTransition = ft
    fill.style.transition = ft
  }
}

function sliderSnap () {
  sliderX = 0
  sliderThumbTransition(true)
  paintSlider()
  setTimeout(function () { sliderThumbTransition(false) }, 180)
}

function commitReset () {
  var track
  if (sliderBusy) return
  sliderBusy = true
  sliderX = sliderMax
  paintSlider()
  track = el('resetSlider')
  if (track) track.className = 'key slider is-busy'
  resetCounter(function (err) {
    sliderBusy = false
    if (track) track.className = 'key slider'
    sliderSnap()
    if (err) {
      setStatus(err.message, true)
      return
    }
    chain = '0.0'
    el('chain').innerHTML = chain
    setStatus('Counter reset')
  })
}

function sliderDown (e) {
  var node = el('resetSlider')
  var knob = el('resetThumb')
  var local
  if (sliderBusy || !node || !knob) return
  local = pageX(e) - node.getBoundingClientRect().left
  if (local > knob.offsetWidth + 28) return
  measureSlider()
  sliderDrag = true
  sliderStartX = pageX(e)
  sliderGrab = sliderX
  sliderThumbTransition(false)
  if (e.preventDefault) e.preventDefault()
}

function sliderMove (e) {
  if (!sliderDrag) return
  sliderX = sliderGrab + (pageX(e) - sliderStartX)
  if (sliderX < 0) sliderX = 0
  if (sliderX > sliderMax) sliderX = sliderMax
  paintSlider()
  if (sliderX >= sliderMax * SLIDER_DONE) {
    sliderDrag = false
    commitReset()
  }
  if (e.preventDefault) e.preventDefault()
}

function sliderUp () {
  if (!sliderDrag) return
  sliderDrag = false
  sliderSnap()
}

el('resetSlider').addEventListener('mousedown', sliderDown, false)
el('resetSlider').addEventListener('touchstart', sliderDown, false)
document.addEventListener('mousemove', sliderMove, false)
document.addEventListener('touchmove', sliderMove, false)
document.addEventListener('mouseup', sliderUp, false)
document.addEventListener('touchend', sliderUp, false)
document.addEventListener('touchcancel', sliderUp, false)

function contentWidth (valueEl, unitEl) {
  var w = valueEl.offsetWidth
  var style
  if (unitEl) {
    w += unitEl.offsetWidth
    style = window.getComputedStyle(unitEl)
    w += parseFloat(style.marginLeft) || 0
    w += parseFloat(style.marginRight) || 0
  }
  return w
}

function applyValueSize (valueEl, unitEl, size) {
  var unitSize = Math.round(size * 0.28)
  if (unitSize < 12) unitSize = 12
  valueEl.style.fontSize = size + 'px'
  if (unitEl) {
    unitEl.style.fontSize = unitSize + 'px'
    unitEl.style.paddingBottom = Math.round(size * 0.06) + 'px'
  }
}

function valueFits (valueEl, unitEl, box) {
  var cap = Math.max(valueEl.offsetHeight, unitEl ? unitEl.offsetHeight : 0)
  return contentWidth(valueEl, unitEl) + 4 <= box.clientWidth && cap + 2 <= box.clientHeight
}

function fitValue (valueEl, unitEl, box) {
  var lo, hi, mid, best
  if (!valueEl || !box) return
  if (box.clientHeight < 8 || box.clientWidth < 8) return
  lo = 16
  hi = Math.floor(box.clientHeight * 0.98)
  if (hi < lo) hi = lo
  best = lo
  applyValueSize(valueEl, unitEl, hi)
  if (valueFits(valueEl, unitEl, box)) return
  while (lo <= hi) {
    mid = (lo + hi) >> 1
    applyValueSize(valueEl, unitEl, mid)
    if (valueFits(valueEl, unitEl, box)) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  applyValueSize(valueEl, unitEl, best)
}

function sizeKey (key, w, h, margin, radius) {
  var lab
  key.style.width = w + 'px'
  key.style.height = h + 'px'
  key.style.maxWidth = 'none'
  key.style.maxHeight = 'none'
  key.style.margin = margin + 'px'
  key.style.borderRadius = radius + 'px'
  key.style.fontSize = Math.max(16, Math.round(w > h * 1.4 ? h * 0.38 : Math.min(w, h) * 0.215)) + 'px'
  lab = key.getElementsByClassName('label')[0]
  if (lab) {
    lab.style.width = w + 'px'
    lab.style.height = h + 'px'
    lab.style.maxWidth = 'none'
  }
}

function sizeSlider (slider, w, h, margin) {
  var hint, thumb, fill, thumbSize, pad
  pad = Math.round(h * 0.62)
  slider.style.width = w + 'px'
  slider.style.height = h + 'px'
  slider.style.maxHeight = 'none'
  slider.style.margin = margin + 'px'
  slider.style.borderRadius = Math.round(h / 2) + 'px'
  slider.style.lineHeight = h + 'px'
  slider.style.fontSize = Math.max(14, Math.round(h * 0.32)) + 'px'
  hint = el('resetHint')
  if (hint) {
    hint.style.fontSize = Math.max(14, Math.round(h * 0.32)) + 'px'
    hint.style.height = h + 'px'
    hint.style.lineHeight = h + 'px'
    hint.style.paddingLeft = pad + 'px'
    hint.style.paddingRight = Math.round(h * 0.7) + 'px'
  }
  thumb = el('resetThumb')
  thumbSize = h - SLIDER_PAD * 2
  thumb.style.width = thumbSize + 'px'
  thumb.style.height = thumbSize + 'px'
  thumb.style.top = SLIDER_PAD + 'px'
  thumb.style.borderRadius = Math.round(thumbSize / 2) + 'px'
  fill = el('resetFill')
  if (fill) fill.style.height = '100%'
  if (!sliderDrag) {
    measureSlider()
    if (sliderX > sliderMax) sliderX = sliderMax
    paintSlider()
  }
}

function fitLayout () {
  var deck = el('actions')
  var key, slider, panels, tiles, captions, readouts, i, vw, vh, gap, keySize, captionPx, radius
  var sliderW, desktop, panel, tile, side, barH, barW, m, align
  if (!deck) return
  vw = window.innerWidth
  vh = window.innerHeight
  if (!vw || !vh) return

  desktop = vw >= 768
  gap = Math.round(Math.min(vw, vh) * 0.012)
  if (gap < 6) gap = 6
  m = Math.floor(gap / 2)
  deck.className = desktop ? 'deck' : 'deck stack'

  key = el('toggle')
  slider = el('resetSlider')
  if (desktop) {
    keySize = Math.floor(vh * 0.2)
    if (keySize > 115) keySize = 115
    if (keySize < 56) keySize = 56
    radius = Math.round(keySize * 0.1875)
    sizeKey(key, keySize, keySize, m, radius)
    sliderW = Math.floor(keySize * 2.6)
    if (sliderW > deck.clientWidth - keySize - gap * 3) {
      sliderW = deck.clientWidth - keySize - gap * 3
    }
    if (sliderW < keySize * 1.8) sliderW = Math.floor(keySize * 1.8)
    sizeSlider(slider, sliderW, keySize, m, radius)
  } else {
    barH = Math.floor(vh * 0.085)
    if (barH > 72) barH = 72
    if (barH < 52) barH = 52
    barW = deck.clientWidth - m * 2
    if (barW < 120) barW = 120
    radius = Math.round(barH * 0.28)
    sizeKey(key, barW, barH, m, radius)
    sizeSlider(slider, barW, barH, m, radius)
  }

  panels = document.getElementsByClassName('panel')
  tiles = document.getElementsByClassName('tile')
  captions = document.getElementsByClassName('caption')
  readouts = document.getElementsByClassName('readout')
  captionPx = Math.round(Math.min(vh * 0.055, vw * 0.07, 42))
  if (captionPx < 16) captionPx = 16
  for (i = 0; i < tiles.length; i++) {
    tile = tiles[i]
    panel = panels[i]
    if (desktop && panel) {
      side = panel.clientWidth
      if (panel.clientHeight < side) side = panel.clientHeight
      tile.style.width = side + 'px'
      tile.style.height = side + 'px'
    } else {
      tile.style.width = '100%'
      tile.style.height = '100%'
    }
  }
  for (i = 0; i < captions.length; i++) {
    captions[i].style.fontSize = captionPx + 'px'
    captions[i].style.textAlign = desktop ? 'right' : 'left'
  }
  align = desktop ? 'flex-end' : 'center'
  for (i = 0; i < readouts.length; i++) {
    readouts[i].style.webkitAlignItems = align
    readouts[i].style.alignItems = align
  }

  fitValue(el('depth'), el('depthRow') && el('depthRow').getElementsByClassName('unit')[0], el('depthRow'))
  fitValue(el('chain'), el('chainRow') && el('chainRow').getElementsByClassName('unit')[0], el('chainRow'))
}

el('depth').innerHTML = depth
el('chain').innerHTML = chain
fitLayout()
window.addEventListener('resize', fitLayout, false)
window.addEventListener('orientationchange', function () {
  setTimeout(fitLayout, 150)
}, false)

checkLogin(function () {
  startDeviceRequest()
})
loadOptions(function () {
  connect()
})
