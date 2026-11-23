
(function () {
  "use strict";

  if (!window.gsap || !window.ScrollTrigger) return;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var motionOn = !reduceMotion;
  var root = document.documentElement;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  root.classList.toggle("motion-off", !motionOn);

  var CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%/:";
  function randomChar() {
    return CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  function isPhone() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  var cover = new Image();
  cover.src = "./assets/pages/cn-cover.jpg";
  var coverReady = false;

  var HERO = {
    desktop: { cols: 12, rows: 6, markRow: 0 },
    phone: { cols: 10, rows: 7, markRow: 0 }
  };

  /* The hero is one live conversation, cycling through what the bot answers.
     The header row stays; only the words that change flip. */
  var EXCHANGES = [
    {
      label: "library: 1,248 pages",
      desktop: ["NBKRISTQIK", "YOU", "/LIBRARY", "QIK", "1,248", "PAGES"],
      phone: ["NBKRISTQIK", "YOU", "/LIBRARY", "QIK", "1,248", "PAGES", "51 DOCS"]
    },
    {
      label: "mid marks: CN 19.5, ATCD 15.5",
      desktop: ["NBKRISTQIK", "YOU", "/MIDMARKS", "QIK", "CN 19.5", "ATCD 15.5"],
      phone: ["NBKRISTQIK", "YOU", "/MIDMARKS", "QIK", "CN 19.5", "ATCD 15.5", ""]
    },
    {
      label: "report QIK-0007, answered",
      desktop: ["NBKRISTQIK", "YOU", "/REPORT", "QIK", "QIK-0007", "ANSWERED"],
      phone: ["NBKRISTQIK", "YOU", "/REPORT", "QIK", "QIK-0007", "ANSWERED", "IN CHAT"]
    },
    {
      label: "leaderboard: rank 47 of 1,240",
      desktop: ["NBKRISTQIK", "YOU", "/LEADERBOARD", "QIK", "#47", "OF 1,240"],
      phone: ["NBKRISTQIK", "YOU", "/LEADER", "BOARD", "QIK", "#47", "OF 1,240"]
    },
    {
      label: "attendance: 76.37 percent, 3 more classes",
      desktop: ["NBKRISTQIK", "YOU", "23CS1042", "QIK", "76.37%", "3 MORE"],
      phone: ["NBKRISTQIK", "YOU", "23CS1042", "QIK", "76.37%", "3 MORE", "139 / 182"]
    }
  ];

  var CUT_RATIO = { desktop: 0.5, phone: 0.625 };

  var STATES = [
    {
      kind: "library",
      rows: { desktop: ["", "", "", "", "", "", "", ""], phone: ["", "", "", "", "", "", "", ""] },
      line: "A PDF IS NOT A LIBRARY.",
      label: "CN Unit I cover assembled across the board. 1,248 pages, 51 documents, 362 diagrams."
    },
    {
      kind: "report",
      rows: {
        desktop: ["", "REPORT", "", "QIK-0007", "", "ANSWERED", "", ""],
        phone: ["", "REPORT", "", "QIK-0007", "", "ANSWERED", "", ""]
      },
      line: "EVERY ISSUE GETS AN ID.",
      label: "Report QIK-0007, answered."
    },
    {
      kind: "leaderboard",
      rows: {
        desktop: ["", "LEADERBOARD", "4 CSE C", "#47  76.37", "", "", "", ""],
        phone: ["", "LEADER", "BOARD", "4 CSE C", "#47  76.37", "", "", ""]
      },
      line: "RANK THE CLASS.",
      label: "Leaderboard, 4 CSE C. Rank 47 at 76.37 percent. The 75 percent line cuts the board below."
    }
  ];
  var heroBoardEl = document.getElementById("hero-board");
  var flipBoardEl = document.getElementById("flip-board");
  var flipSection = document.getElementById("library");
  var flipFrame = document.getElementById("flip-frame");
  var flipLineEl = document.getElementById("flip-line");
  var cutEl = document.getElementById("cut");
  var cutLabel = cutEl.querySelector(".cut__label");
  var sweepEl = document.getElementById("sweep");
  var readoutPanels = gsap.utils.toArray(".readout__panel");
  var rankRows = gsap.utils.toArray(".readout__panel[data-panel='2'] .ranks li");
  var rail = document.querySelector(".rail");
  var heroBand = document.querySelector(".hero__band");
  var menuRows = gsap.utils.toArray(".menu__row:not(.menu__row--head)");
  var noteRows = gsap.utils.toArray(".note");
  var menuTriggers = [];
  var noteTriggers = [];
  var lineTl = null;
  var sweepTl = null;

  /* ---------- the pointer is a reader head ---------- */
  var heroReady = false;
  var tiltState = { x: 0, y: 0, tx: 0, ty: 0 };
  var hotCell = null;
  var magState = { x: 0, y: 0, tx: 0, ty: 0 };
  var heroCtaEl = document.querySelector(".hero__cta");
  var footCtaEl = document.querySelector(".foot__cta");
  var magEls = [heroCtaEl].filter(Boolean);

  function clampNum(value, low, high) {
    return value < low ? low : value > high ? high : value;
  }

  function setHot(board, x, y, rect) {
    var next = null;
    if (
      board &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      var col = clampNum(Math.floor(((x - rect.left) / rect.width) * board.cols), 0, board.cols - 1);
      var row = clampNum(Math.floor(((y - rect.top) / rect.height) * board.rows), 0, board.rows - 1);
      next = board.cells[row * board.cols + col] || null;
    }
    if (next !== hotCell) {
      if (hotCell) hotCell.classList.remove("is-hot");
      hotCell = next;
      if (hotCell) hotCell.classList.add("is-hot");
    }
  }

  function lightBoard(el, board, x, y) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    var pad = 70;
    if (x < rect.left - pad || x > rect.right + pad || y < rect.top - pad || y > rect.bottom + pad) {
      el.classList.remove("is-lit");
      return false;
    }
    el.classList.add("is-lit");
    el.style.setProperty("--mx", clampNum(x - rect.left, 0, rect.width) + "px");
    el.style.setProperty("--my", clampNum(y - rect.top, 0, rect.height) + "px");
    el.style.setProperty("--scan", clampNum(y - rect.top, 0, rect.height) + "px");
    setHot(board, x, y, rect);
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function clearPointer() {
    [heroBoardEl, flipBoardEl].forEach(function (el) {
      if (el) el.classList.remove("is-lit");
    });
    if (hotCell) {
      hotCell.classList.remove("is-hot");
      hotCell = null;
    }
    tiltState.tx = 0;
    tiltState.ty = 0;
    magState.tx = 0;
    magState.ty = 0;
  }

  function onPointerMove(event) {
    if (!motionOn || event.pointerType === "touch") return;
    var overHero = lightBoard(heroBoardEl, hero, event.clientX, event.clientY);
    var overFlip = lightBoard(flipBoardEl, flip, event.clientX, event.clientY);
    if (!overHero && !overFlip && hotCell) {
      hotCell.classList.remove("is-hot");
      hotCell = null;
    }

    if (flipFrame) {
      var rect = flipFrame.getBoundingClientRect();
      var pad = 150;
      if (
        event.clientX > rect.left - pad &&
        event.clientX < rect.right + pad &&
        event.clientY > rect.top - pad &&
        event.clientY < rect.bottom + pad
      ) {
        var nx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
        var ny = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
        tiltState.tx = clampNum(-ny * 2.2, -2.2, 2.2);
        tiltState.ty = clampNum(nx * 3, -3, 3);
      } else {
        tiltState.tx = 0;
        tiltState.ty = 0;
      }
    }

    magState.tx = 0;
    magState.ty = 0;
    if (window.innerWidth <= 760) return;
    for (var m = 0; m < magEls.length; m += 1) {
      var box = magEls[m].getBoundingClientRect();
      var edge = 20;
      if (
        event.clientX > box.left - edge &&
        event.clientX < box.right + edge &&
        event.clientY > box.top - edge &&
        event.clientY < box.bottom + edge
      ) {
        magState.tx = clampNum((event.clientX - (box.left + box.width / 2)) * 0.06, -4, 4);
        magState.ty = clampNum((event.clientY - (box.top + box.height / 2)) * 0.1, -4, 4);
      }
    }
  }

  function animatePointer() {
    if (motionOn) {
      tiltState.x += (tiltState.tx - tiltState.x) * 0.14;
      tiltState.y += (tiltState.ty - tiltState.y) * 0.14;
      if (flipFrame) {
        flipFrame.style.setProperty("--tilt-x", tiltState.x.toFixed(2) + "deg");
        flipFrame.style.setProperty("--tilt-y", tiltState.y.toFixed(2) + "deg");
      }
      magState.x += (magState.tx - magState.x) * 0.18;
      magState.y += (magState.ty - magState.y) * 0.18;
      for (var i = 0; i < magEls.length; i += 1) {
        magEls[i].style.setProperty("--mag-x", magState.x.toFixed(1) + "px");
        magEls[i].style.setProperty("--mag-y", magState.y.toFixed(1) + "px");
      }
    } else {
      tiltState.x = 0;
      tiltState.y = 0;
      magState.x = 0;
      magState.y = 0;
    }
    requestAnimationFrame(animatePointer);
  }


  function layout(lines, cols, rows, align) {
    var chars = [];
    var i;
    for (i = 0; i < cols * rows; i += 1) chars.push(" ");
    for (var r = 0; r < lines.length && r < rows; r += 1) {
      var text = String(lines[r]).slice(0, cols);
      var start =
        align === "left"
          ? 0
          : Math.max(0, Math.floor((cols - text.length) / 2));
      for (var c = 0; c < text.length; c += 1) chars[r * cols + start + c] = text.charAt(c);
    }
    return chars;
  }

  function buildBoard(el, cols, rows) {
    el.innerHTML = "";
    el.style.setProperty("--cols", String(cols));
    el.style.setProperty("--rows", String(rows));
    var cells = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < cols * rows; i += 1) {
      var cell = document.createElement("span");
      cell.className = "cell";
      cell.setAttribute("aria-hidden", "true");
      cell.dataset.char = " ";
      cell.innerHTML =
        '<span class="cell__half cell__half--top"><span class="cell__glyph"> </span></span>' +
        '<span class="cell__half cell__half--bottom"><span class="cell__glyph"> </span></span>' +
        '<span class="cell__tile" aria-hidden="true"></span>' +
        '<span class="cell__flap cell__flap--top"><span class="cell__glyph"> </span><span class="cell__shade"></span></span>' +
        '<span class="cell__flap cell__flap--bottom"><span class="cell__glyph"> </span><span class="cell__shade"></span></span>' +
        '<span class="cell__seam"></span>';
      cells.push(cell);
      frag.appendChild(cell);
    }
    el.appendChild(frag);
    return { el: el, cols: cols, rows: rows, cells: cells };
  }

  function partsOf(cell) {
    if (!cell._parts) {
      var topFlap = cell.querySelector(".cell__flap--top");
      var bottomFlap = cell.querySelector(".cell__flap--bottom");
      cell._parts = {
        top: cell.querySelector(".cell__half--top .cell__glyph"),
        bottom: cell.querySelector(".cell__half--bottom .cell__glyph"),
        tile: cell.querySelector(".cell__tile"),
        topFlap: topFlap,
        bottomFlap: bottomFlap,
        topGlyph: topFlap.querySelector(".cell__glyph"),
        bottomGlyph: bottomFlap.querySelector(".cell__glyph"),
        topShade: topFlap.querySelector(".cell__shade"),
        bottomShade: bottomFlap.querySelector(".cell__shade")
      };
    }
    return cell._parts;
  }

  function commitCell(cell, ch) {
    if (cell._tl) {
      cell._tl.kill();
      cell._tl = null;
    }
    var p = partsOf(cell);
    p.top.textContent = ch;
    p.bottom.textContent = ch;
    cell.dataset.char = ch;
    cell.dataset.target = ch;
    gsap.set(p.topFlap, { rotationX: 0, autoAlpha: 0 });
    gsap.set(p.bottomFlap, { rotationX: 0, autoAlpha: 0 });
  }

  function snapBoard(board, chars) {
    for (var i = 0; i < board.cells.length; i += 1) {
      commitCell(board.cells[i], chars[i] == null ? " " : chars[i]);
    }
  }

  function flipCell(cell, ch, delay) {
    var from = cell.dataset.char;
    cell.dataset.target = ch;
    if (from === ch && ch !== " ") return;

    var p = partsOf(cell);
    if (cell._tl) {
      cell._tl.kill();
      cell._tl = null;
    }

    p.top.textContent = ch;
    p.bottom.textContent = from;
    p.topGlyph.textContent = from;
    p.bottomGlyph.textContent = ch;

    gsap.set(p.topFlap, { rotationX: 0, autoAlpha: 1 });
    gsap.set(p.bottomFlap, { rotationX: 90, autoAlpha: 1 });
    gsap.set(p.topShade, { opacity: 0 });
    gsap.set(p.bottomShade, { opacity: 0.55 });

    var tl = gsap.timeline({
      delay: delay,
      onComplete: function () {
        cell._tl = null;
        p.top.textContent = ch;
        p.bottom.textContent = ch;
        cell.dataset.char = ch;
        gsap.set(p.topFlap, { autoAlpha: 0 });
        gsap.set(p.bottomFlap, { autoAlpha: 0 });
        if (motionOn) gsap.fromTo(cell, { y: 0.6 }, { y: 0, duration: 0.14, ease: "power2.out", overwrite: true });
      }
    });

    tl.to(p.topFlap, { rotationX: -90, duration: 0.18, ease: "power2.in" }, 0)
      .to(p.topShade, { opacity: 0.72, duration: 0.18, ease: "power2.in" }, 0)
      .to(p.bottomFlap, { rotationX: 0, duration: 0.22, ease: "power3.out" }, 0.07)
      .to(p.bottomShade, { opacity: 0, duration: 0.22, ease: "power2.out" }, 0.07);

    cell._tl = tl;
  }

  function play(board, chars, speed, done) {
    for (var i = 0; i < board.cells.length; i += 1) {
      commitCell(board.cells[i], board.cells[i].dataset.target || board.cells[i].dataset.char);
    }

    if (!motionOn) {
      snapBoard(board, chars);
      if (done) done();
      return 0;
    }

    var maxDelay = 0;
    for (var j = 0; j < board.cells.length; j += 1) {
      var row = Math.floor(j / board.cols);
      var col = j % board.cols;
      var delay = (row * 0.045 + col * 0.03) * speed + Math.random() * 0.02;
      if (delay > maxDelay) maxDelay = delay;
      flipCell(board.cells[j], chars[j], delay);
    }
    if (done) gsap.delayedCall(maxDelay + 0.28, done);
    return maxDelay + 0.28;
  }

  function randomize(board) {
    for (var i = 0; i < board.cells.length; i += 1) commitCell(board.cells[i], randomChar());
  }

  function showLine(text, animate) {
    if (!animate || !motionOn) {
      if (lineTl) {
        lineTl.kill();
        lineTl = null;
      }
      flipLineEl.textContent = text;
      gsap.set(flipLineEl, { opacity: 1, y: 0 });
      return;
    }
    if (lineTl) lineTl.kill();
    lineTl = gsap.timeline()
      .to(flipLineEl, { opacity: 0, y: -8, duration: 0.12, ease: "power2.in" })
      .add(function () { flipLineEl.textContent = text; })
      .fromTo(flipLineEl, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" });
  }

  function showPanel(index, animate) {
    for (var i = 0; i < readoutPanels.length; i += 1) {
      var panel = readoutPanels[i];
      if (i === index) {
        panel.hidden = false;
        panel.setAttribute("aria-hidden", "false");
      } else {
        panel.hidden = true;
        panel.setAttribute("aria-hidden", "true");
      }
    }
    var active = readoutPanels[index];
    gsap.killTweensOf(active);
    if (animate && motionOn) {
      gsap.fromTo(active, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" });
    } else {
      gsap.set(active, { opacity: 1, y: 0 });
    }
  }

  var breakpoint = isPhone() ? "phone" : "desktop";
  var hero = null;
  var flip = null;
  var currentState = 0;
  var stateToken = 0;
  var flipEntered = false;
  var cutOn = false;
  var flipTrigger = null;

  function cutTop() {
    if (!flip) return 0;
    return Math.round(flipBoardEl.offsetHeight * CUT_RATIO[breakpoint]);
  }

  function positionCut() {
    if (!flip || STATES[currentState].kind !== "leaderboard") {
      cutOn = false;
      clearCutTint();
      return;
    }
    if (!flipBoardEl.offsetHeight) return;
    var y = cutTop();
    cutEl.style.top = (1 + y) + "px";
    for (var i = 0; i < flip.cells.length; i += 1) {
      flip.cells[i].classList.toggle("is-cut", flip.cells[i].offsetTop >= y);
    }
  }

  function showCut(animate) {
    if (!flip || STATES[currentState].kind !== "leaderboard") return;
    positionCut();
    cutOn = true;
    if (animate && motionOn) {
      gsap.set(cutEl, { opacity: 1, scaleX: 0 });
      gsap.set(cutLabel, { opacity: 0, y: -4 });
      gsap.set(rankRows, { opacity: 0, y: 8 });
      gsap.to(cutEl, { scaleX: 1, duration: 0.55, ease: "power3.inOut" });
      gsap.to(cutLabel, { opacity: 1, y: 0, duration: 0.25, delay: 0.32, ease: "power2.out" });
      gsap.to(rankRows, { opacity: 1, y: 0, duration: 0.28, stagger: 0.06, delay: 0.42, ease: "power2.out" });
    } else {
      gsap.set(cutEl, { opacity: 1, scaleX: 1 });
      gsap.set(cutLabel, { opacity: 1, y: 0 });
      gsap.set(rankRows, { opacity: 1, y: 0 });
    }
  }

  function clearCutTint() {
    if (!flip) return;
    for (var i = 0; i < flip.cells.length; i += 1) flip.cells[i].classList.remove("is-cut");
  }

  function hideCut(animate) {
    cutOn = false;
    if (animate && motionOn) {
      gsap.to(cutEl, { opacity: 0, duration: 0.2, ease: "power2.in" });
    } else {
      gsap.set(cutEl, { opacity: 0, scaleX: 0 });
    }
    gsap.set(cutLabel, { opacity: 0 });
    clearCutTint();
  }

  function sizeMosaic() {
    if (!flip || !flipBoardEl) return;
    var w = flipBoardEl.clientWidth;
    var h = flipBoardEl.clientHeight;
    if (!w || !h) return;
    var nw = cover.naturalWidth || 1242;
    var nh = cover.naturalHeight || 1756;
    var scale = Math.max(w / nw, h / nh);
    var drawW = nw * scale;
    var drawH = nh * scale;
    var ox = (drawW - w) / 2;
    var oy = (drawH - h) * 0.28;

    for (var i = 0; i < flip.cells.length; i += 1) {
      var cell = flip.cells[i];
      var tile = partsOf(cell).tile;
      var x = cell.offsetLeft + cell.clientLeft + ox;
      var y = cell.offsetTop + cell.clientTop + oy;
      tile.style.backgroundSize = drawW + "px " + drawH + "px";
      tile.style.backgroundPosition = (-x) + "px " + (-y) + "px";
      if (coverReady) tile.style.backgroundImage = "url('./assets/pages/cn-cover.jpg')";
    }
  }

  function tiles() {
    return flip ? flip.cells.map(function (cell) { return partsOf(cell).tile; }) : [];
  }

  function showTilesInstant() {
    gsap.set(tiles(), { opacity: 1, rotationX: 0 });
  }

  function hideTilesInstant() {
    gsap.set(tiles(), { opacity: 0, rotationX: -90 });
  }

  function tilesIn() {
    flipBoardEl.classList.add("is-mosaic");
    sizeMosaic();
    clearCutTint();
    var list = tiles();
    gsap.set(list, { opacity: 0, rotationX: -90 });
    for (var i = 0; i < list.length; i += 1) {
      var row = Math.floor(i / flip.cols);
      var col = i % flip.cols;
      gsap.to(list[i], {
        opacity: 1,
        rotationX: 0,
        duration: 0.38,
        delay: (row * 0.032 + col * 0.022) + 0.03,
        ease: "power3.out"
      });
    }
  }

  function exitMosaic(done) {
    var list = tiles();
    gsap.killTweensOf(list);
    if (!motionOn) {
      hideTilesInstant();
      done();
      return;
    }
    var maxDelay = 0;
    for (var i = 0; i < list.length; i += 1) {
      var row = Math.floor(i / flip.cols);
      var col = i % flip.cols;
      var delay = row * 0.012 + col * 0.01;
      if (delay > maxDelay) maxDelay = delay;
      gsap.to(list[i], { opacity: 0, rotationX: 90, duration: 0.28, delay: delay, ease: "power2.in" });
    }
    gsap.delayedCall(maxDelay + 0.3, done);
  }

  function enterMosaic(animate, token) {
    hideCut(false);
    clearCutTint();
    flipBoardEl.classList.add("is-mosaic");
    sizeMosaic();
    var blanks = layout([], flip.cols, flip.rows);
    if (!animate || !motionOn) {
      snapBoard(flip, blanks);
      showTilesInstant();
      return;
    }
    var duration = play(flip, blanks, 1, null);
    gsap.delayedCall(Math.max(0.35, duration * 0.92), function () {
      if (token === stateToken) tilesIn();
    });
  }

  function applyState(index, animate) {
    var token = ++stateToken;
    var previous = currentState;
    currentState = index;
    var state = STATES[index];

    gsap.killTweensOf(tiles());
    showLine(state.line, animate);
    showPanel(index, animate);
    flipBoardEl.setAttribute("aria-label", "Split-flap board: " + state.label);

    if (state.kind === "library") {
      enterMosaic(animate, token);
      return;
    }

    hideCut(false);
    clearCutTint();
    if (state.kind === "leaderboard" && animate && motionOn) gsap.set(rankRows, { opacity: 0, y: 8 });

    function runText() {
      if (token !== stateToken) return;
      flipBoardEl.classList.remove("is-mosaic");
      sizeMosaic();
      hideTilesInstant();
      var chars = layout(state.rows[breakpoint], flip.cols, flip.rows);
      if (animate && motionOn) {
        play(flip, chars, 1, function () {
          if (token !== stateToken) return;
          if (state.kind === "leaderboard") showCut(true);
          else hideCut(false);
        });
      } else {
        snapBoard(flip, chars);
        if (state.kind === "leaderboard") showCut(false);
      }
    }

    if (STATES[previous].kind === "library" && animate && motionOn) {
      exitMosaic(runText);
    } else {
      runText();
    }

    gsap.delayedCall(1.1, function () {
      if (STATES[currentState].kind !== "leaderboard") clearCutTint();
    });
  }

  function stateFor(progress) {
    if (progress < 1 / 3) return 0;
    if (progress < 2 / 3) return 1;
    return 2;
  }

  function enterFlip() {
    if (flipEntered) return;
    flipEntered = true;
    if (motionOn) randomize(flip);
    applyState(currentState, motionOn);
  }

  function syncFlipFromScroll() {
    if (flipEntered || !flipTrigger) return;
    var rect = flipSection.getBoundingClientRect();
    if (rect.top > 0 || rect.bottom <= 0) return;
    currentState = stateFor(flipTrigger.progress);
    enterFlip();
  }

  function setupFlipTrigger() {
    if (flipTrigger) flipTrigger.kill();
    flipTrigger = ScrollTrigger.create({
      trigger: flipSection,
      start: "top top",
      end: "bottom bottom",
      onToggle: function (self) {
        if (self.isActive && !flipEntered) {
          currentState = stateFor(self.progress);
          enterFlip();
        }
      },
      onUpdate: function (self) {
        if (!self.isActive && !flipEntered) return;
        var index = stateFor(self.progress);
        if (!flipEntered) {
          currentState = index;
          enterFlip();
          return;
        }
        if (index !== currentState) applyState(index, motionOn);
      }
    });

    requestAnimationFrame(syncFlipFromScroll);
  }

  function heroChars(index) {
    var spec = HERO[breakpoint];
    var exchange = EXCHANGES[index] || EXCHANGES[0];
    return layout(exchange[breakpoint], spec.cols, spec.rows, "left");
  }

  function updateHeroLabel(index) {
    var exchange = EXCHANGES[index] || EXCHANGES[0];
    heroBoardEl.setAttribute(
      "aria-label",
      "Split-flap chat: NbkristQik, " + exchange.label + ".",
    );
  }

  function buildHero() {
    var spec = HERO[breakpoint];
    hero = buildBoard(heroBoardEl, spec.cols, spec.rows);
    hero.exchange = 0;
    hero.final = heroChars(0);
    for (var i = 0; i < hero.cells.length; i += 1) {
      commitCell(hero.cells[i], " ");
      if (Math.floor(i / spec.cols) === spec.markRow) hero.cells[i].classList.add("is-yellow");
    }
    updateHeroLabel(0);
  }

  function buildFlip() {
    flipBoardEl.classList.remove("is-mosaic");
    flip = buildBoard(flipBoardEl, breakpoint === "phone" ? 10 : 12, 8);
    for (var i = 0; i < flip.cells.length; i += 1) commitCell(flip.cells[i], " ");
    requestAnimationFrame(function () {
      sizeMosaic();
      positionCut();
    });
  }

  var heroTimer = null;

  function stopHeroCycle() {
    if (heroTimer) {
      clearTimeout(heroTimer);
      heroTimer = null;
    }
  }

  function scheduleHeroCycle() {
    stopHeroCycle();
    if (!motionOn) return;
    heroTimer = setTimeout(function () {
      heroTimer = null;
      if (!motionOn) return;
      if (document.hidden || !heroBoardEl) {
        scheduleHeroCycle();
        return;
      }
      var rect = heroBoardEl.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        scheduleHeroCycle();
        return;
      }
      advanceHero(true);
      scheduleHeroCycle();
    }, 4200);
  }

  function flipHeroTo(chars, animate) {
    if (!hero) return;
    hero.final = chars;
    if (!animate || !motionOn) {
      snapBoard(hero, chars);
      return;
    }
    var spec = HERO[breakpoint];
    for (var i = 0; i < hero.cells.length; i += 1) {
      if (chars[i] === hero.cells[i].dataset.char) continue;
      var row = Math.floor(i / spec.cols);
      var col = i % spec.cols;
      flipCell(hero.cells[i], chars[i], row * 0.035 + col * 0.018);
    }
  }

  function advanceHero(animate) {
    if (!hero || !heroReady) return;
    hero.exchange = (hero.exchange + 1) % EXCHANGES.length;
    flipHeroTo(heroChars(hero.exchange), animate);
    updateHeroLabel(hero.exchange);
  }

  function startHero(animate) {
    if (!hero) return;
    heroReady = false;
    if (animate && motionOn) {
      randomize(hero);
      gsap.set([rail, heroBand], { opacity: 0, y: 12 });
      var duration = play(hero, hero.final, 1.15, null);
      gsap.delayedCall(duration + 0.1, function () {
        heroReady = true;
        scheduleHeroCycle();
      });
      gsap.to([rail, heroBand], {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.08,
        delay: Math.max(0.45, duration - 0.3),
        ease: "power2.out"
      });
    } else {
      snapBoard(hero, hero.final);
      gsap.set([rail, heroBand], { opacity: 1, y: 0 });
      heroReady = true;
      scheduleHeroCycle();
    }
  }

  function startSweep() {
    if (sweepTl) {
      sweepTl.kill();
      sweepTl = null;
    }
    gsap.set(sweepEl, { opacity: 0, y: -2 });
    if (!motionOn || !flipBoardEl.offsetHeight) return;
    var h = flipBoardEl.offsetHeight;
    sweepTl = gsap.timeline({ repeat: -1, repeatDelay: 7 });
    sweepTl
      .fromTo(sweepEl, { y: -2, opacity: 0 }, { y: h, opacity: 0.22, duration: 4.5, ease: "none" })
      .to(sweepEl, { opacity: 0, duration: 0.5 }, "-=0.5");
  }

  function stopSweep() {
    if (sweepTl) {
      sweepTl.kill();
      sweepTl = null;
    }
    gsap.set(sweepEl, { opacity: 0 });
  }

  function setupMenu() {
    for (var i = 0; i < menuTriggers.length; i += 1) menuTriggers[i].kill();
    menuTriggers = [];
    for (var j = 0; j < menuRows.length; j += 1) {
      gsap.killTweensOf(menuRows[j]);
      gsap.set(menuRows[j], { clearProps: "all" });
    }
    if (!motionOn) return;
    gsap.set(menuRows, { rotationX: -42, y: 14, opacity: 0, transformOrigin: "50% 0%" });
    menuTriggers = ScrollTrigger.batch(menuRows, {
      start: "top 92%",
      once: true,
      onEnter: function (batch) {
        gsap.to(batch, { rotationX: 0, y: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: "power2.out", overwrite: true });
      }
    });
  }

  function setupNotes() {
    for (var i = 0; i < noteTriggers.length; i += 1) noteTriggers[i].kill();
    noteTriggers = [];
    for (var j = 0; j < noteRows.length; j += 1) {
      gsap.killTweensOf(noteRows[j]);
      gsap.set(noteRows[j], { clearProps: "all" });
    }
    if (!motionOn) return;
    gsap.set(noteRows, { y: 16, opacity: 0 });
    noteTriggers = ScrollTrigger.batch(noteRows, {
      start: "top 94%",
      once: true,
      onEnter: function (batch) {
        gsap.to(batch, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08, ease: "power2.out", overwrite: true });
      }
    });
  }

  function freezeAll() {
    stateToken += 1;
    stopSweep();
    stopHeroCycle();
    clearPointer();
    [heroBoardEl, flipBoardEl].forEach(function (el) {
      if (el) el.classList.remove("is-lit");
    });
    if (flipFrame) {
      flipFrame.style.setProperty("--tilt-x", "0deg");
      flipFrame.style.setProperty("--tilt-y", "0deg");
    }
    for (var c = 0; c < magEls.length; c += 1) {
      magEls[c].style.setProperty("--mag-x", "0px");
      magEls[c].style.setProperty("--mag-y", "0px");
    }
    var boards = [hero, flip];
    for (var b = 0; b < boards.length; b += 1) {
      var board = boards[b];
      if (!board) continue;
      for (var i = 0; i < board.cells.length; i += 1) {
        var cell = board.cells[i];
        commitCell(cell, cell.dataset.target || cell.dataset.char);
      }
    }
    if (lineTl) {
      lineTl.kill();
      lineTl = null;
    }
    gsap.set([rail, heroBand], { opacity: 1, y: 0 });
    if (hero && hero.final) snapBoard(hero, hero.final);
    gsap.killTweensOf(tiles());
    if (flip) {
      if (STATES[currentState].kind === "library") {
        flipBoardEl.classList.add("is-mosaic");
        sizeMosaic();
        hideCut(false);
        clearCutTint();
        snapBoard(flip, layout([], flip.cols, flip.rows));
        showTilesInstant();
      } else {
        flipBoardEl.classList.remove("is-mosaic");
        sizeMosaic();
        hideTilesInstant();
        snapBoard(flip, layout(STATES[currentState].rows[breakpoint], flip.cols, flip.rows));
        if (STATES[currentState].kind === "leaderboard") showCut(false);
        else hideCut(false);
      }
    }
    showLine(STATES[currentState].line, false);
    showPanel(currentState, false);
    gsap.set(flipLineEl, { opacity: 1, y: 0 });
    for (var r = 0; r < menuRows.length; r += 1) {
      gsap.killTweensOf(menuRows[r]);
      gsap.set(menuRows[r], { rotationX: 0, y: 0, opacity: 1 });
    }
    for (var n = 0; n < noteRows.length; n += 1) {
      gsap.killTweensOf(noteRows[n]);
      gsap.set(noteRows[n], { y: 0, opacity: 1 });
    }
  }

  buildHero();
  buildFlip();
  applyState(0, false);
  startHero(true);
  setupMenu();
  setupNotes();
  setupFlipTrigger();
  ScrollTrigger.refresh();
  syncFlipFromScroll();
  startSweep();

  var motionBtn = document.getElementById("motion-toggle");

  function updateMotionButton() {
    if (!motionBtn) return;
    motionBtn.textContent = motionOn ? "PAUSE LOOP" : "PLAY LOOP";
    motionBtn.setAttribute(
      "aria-label",
      motionOn ? "Pause the looping chat demo" : "Play the looping chat demo",
    );
  }

  function setMotion(on) {
    motionOn = on;
    root.classList.toggle("motion-off", !on);
    if (!on) freezeAll();
    else {
      startSweep();
      scheduleHeroCycle();
    }
    updateMotionButton();
  }

  if (motionBtn) {
    motionBtn.addEventListener("click", function () {
      setMotion(!motionOn);
    });
    updateMotionButton();
  }

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", clearPointer);
  window.addEventListener("blur", clearPointer);
  heroBoardEl.addEventListener("click", function () {
    advanceHero(true);
    scheduleHeroCycle();
  });
  requestAnimationFrame(animatePointer);

  if (cover.decode) {
    cover.decode().then(function () {
      coverReady = true;
      sizeMosaic();
      if (STATES[currentState].kind === "library" && !motionOn) showTilesInstant();
    }).catch(function () {
      coverReady = true;
      sizeMosaic();
      if (STATES[currentState].kind === "library" && !motionOn) showTilesInstant();
    });
  } else {
    cover.onload = function () {
      coverReady = true;
      sizeMosaic();
      if (STATES[currentState].kind === "library" && !motionOn) showTilesInstant();
    };
  }

  window.addEventListener("load", function () {
    sizeMosaic();
    startSweep();
  });

  var lastPhone = isPhone();
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var nowPhone = isPhone();
      if (nowPhone !== lastPhone) {
        lastPhone = nowPhone;
        breakpoint = nowPhone ? "phone" : "desktop";
        buildHero();
        buildFlip();
        startHero(false);
        applyState(currentState, false);
        sizeMosaic();
        setupMenu();
        setupNotes();
        ScrollTrigger.refresh();
        if (STATES[currentState].kind !== "leaderboard") clearCutTint();
        startSweep();
        return;
      }
      sizeMosaic();
      if (cutOn) positionCut();
      ScrollTrigger.refresh();
      if (STATES[currentState].kind !== "leaderboard") clearCutTint();
    }, 180);
  });
})();
