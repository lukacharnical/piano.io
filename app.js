const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const keyNotes = Array.from({ length: 25 }, (_, index) => 48 + index);
const padNotes = [36, 37, 38, 39, 40, 41, 42, 43];
const knobDefaults = [70, 71, 72, 73, 74, 75, 76, 77];
const volumeCc = 76;
const standardVolumeCc = 7;
const volumeMacroIndex = 6;
const macroNames = ["Filtre", "Reso", "Delay", "Reverb", "Attack", "Release", "Volume", "Master"];
const storageKey = "mpk-mini-web-macros";
const programs = {
  36: { name: "Piano", wave: "triangle", attack: 0.01, release: 0.22, level: 0.48 },
  37: { name: "Guitare", wave: "sawtooth", attack: 0.004, release: 0.14, level: 0.38 },
  38: { name: "Violon", wave: "sine", attack: 0.16, release: 0.42, level: 0.44 }
};

const dom = {
  connect: document.querySelector("#connect-midi"),
  midiState: document.querySelector("#midi-state"),
  audioState: document.querySelector("#audio-state"),
  note: document.querySelector("#display-note"),
  detail: document.querySelector("#display-detail"),
  inputSelect: document.querySelector("#input-select"),
  wave: document.querySelector("#wave-select"),
  volume: document.querySelector("#volume"),
  knobBank: document.querySelector("#knob-bank"),
  padBank: document.querySelector("#pad-bank"),
  keyboard: document.querySelector("#keyboard"),
  macroGrid: document.querySelector("#macro-grid"),
  log: document.querySelector("#event-log"),
  exportPreset: document.querySelector("#export-preset"),
  importPreset: document.querySelector("#import-preset"),
  resetMap: document.querySelector("#reset-map"),
  clearLog: document.querySelector("#clear-log")
};

let midiAccess;
let selectedInputId = "";
let learnSlot = null;
let audioContext;
let masterGain;
let activeProgram = programs[36];
const activeVoices = new Map();
const macros = loadMacros();

function loadMacros() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  if (Array.isArray(saved) && saved.length === 8) return saved;
  return macroNames.map((name, index) => ({
    name,
    type: "cc",
    number: knobDefaults[index],
    value: 0
  }));
}

function saveMacros() {
  localStorage.setItem(storageKey, JSON.stringify(macros));
}

function noteName(note) {
  return `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`;
}

function ensureAudio() {
  if (audioContext) return;
  audioContext = new AudioContext();
  masterGain = audioContext.createGain();
  masterGain.gain.value = Number(dom.volume.value) / 100;
  masterGain.connect(audioContext.destination);
}

function setStatus(text) {
  dom.midiState.textContent = text;
}

function logEvent(text) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  dom.log.prepend(item);
  while (dom.log.children.length > 40) {
    dom.log.lastElementChild.remove();
  }
}

function renderController() {
  dom.knobBank.innerHTML = "";
  knobDefaults.forEach((cc, index) => {
    const knob = document.createElement("div");
    knob.className = "knob";
    knob.dataset.cc = cc;
    const label = cc === volumeCc ? "Volume" : `CC ${cc}`;
    knob.innerHTML = `
      <div class="dial" style="--turn: 0deg"></div>
      <strong>K${index + 1}</strong>
      <span>${label}</span>
    `;
    dom.knobBank.appendChild(knob);
  });

  dom.padBank.innerHTML = "";
  padNotes.forEach((note, index) => {
    const pad = document.createElement("button");
    pad.type = "button";
    pad.className = "pad";
    pad.dataset.note = note;
    const program = programs[note];
    pad.innerHTML = `<strong>PAD ${index + 1}</strong><span>${program ? program.name : noteName(note)}</span>`;
    pad.addEventListener("pointerdown", () => {
      if (program) selectProgram(note);
      playNote(note, 108);
    });
    pad.addEventListener("pointerup", () => stopNote(note));
    pad.addEventListener("pointerleave", () => stopNote(note));
    dom.padBank.appendChild(pad);
  });

  dom.keyboard.innerHTML = "";
  keyNotes.forEach((note) => {
    const key = document.createElement("button");
    key.type = "button";
    key.className = `key ${noteNames[note % 12].includes("#") ? "black" : "white"}`;
    key.dataset.note = note;
    key.title = noteName(note);
    key.addEventListener("pointerdown", () => playNote(note, 92));
    key.addEventListener("pointerup", () => stopNote(note));
    key.addEventListener("pointerleave", () => stopNote(note));
    dom.keyboard.appendChild(key);
  });
}

function renderMacros() {
  dom.macroGrid.innerHTML = "";
  macros.forEach((macro, index) => {
    const card = document.createElement("article");
    card.className = `macro-card ${learnSlot === index ? "is-learning" : ""}`;
    const label = macro.type === "note" ? `Note ${noteName(macro.number)}` : `CC ${macro.number}`;
    card.innerHTML = `
      <strong>${macro.name}</strong>
      <span>${label} · ${Math.round((macro.value || 0) / 127 * 100)}%</span>
      <button type="button">${learnSlot === index ? "En écoute" : "Apprendre"}</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      learnSlot = learnSlot === index ? null : index;
      dom.detail.textContent = learnSlot === null ? "mapping prêt" : `bouge un knob ou un pad pour ${macro.name}`;
      renderMacros();
    });
    dom.macroGrid.appendChild(card);
  });
}

function updateInputs() {
  const inputs = midiAccess ? [...midiAccess.inputs.values()] : [];
  dom.inputSelect.innerHTML = "";

  if (!inputs.length) {
    const option = document.createElement("option");
    option.textContent = "Aucune entrée MIDI";
    option.value = "";
    dom.inputSelect.appendChild(option);
    return;
  }

  inputs.forEach((input) => {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.name || input.manufacturer || "Entrée MIDI";
    dom.inputSelect.appendChild(option);
  });

  if (!selectedInputId || !inputs.some((input) => input.id === selectedInputId)) {
    const mpk = inputs.find((input) => /mpk|akai/i.test(`${input.name} ${input.manufacturer}`));
    selectedInputId = (mpk || inputs[0]).id;
  }

  dom.inputSelect.value = selectedInputId;
  bindSelectedInput();
}

function bindSelectedInput() {
  if (!midiAccess) return;
  midiAccess.inputs.forEach((input) => {
    input.onmidimessage = input.id === selectedInputId ? handleMidi : null;
  });
  const selected = midiAccess.inputs.get(selectedInputId);
  setStatus(selected ? `Connecté : ${selected.name || "MIDI"}` : "MIDI non connecté");
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    setStatus("Web MIDI indisponible dans ce navigateur");
    logEvent("Utilise Chrome ou Edge sur localhost/HTTPS");
    return;
  }

  try {
    ensureAudio();
    await audioContext.resume();
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = () => updateInputs();
    updateInputs();
    logEvent("MIDI prêt");
  } catch (error) {
    setStatus("Connexion MIDI refusée");
    logEvent(error.message);
  }
}

function handleMidi(event) {
  const [status, data1, data2] = event.data;
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;

  if (command === 0x90 && data2 > 0) {
    learn("note", data1, data2);
    if (programs[data1]) {
      selectProgram(data1);
    }
    playNote(data1, data2);
    logEvent(`CH${channel} NOTE ON  ${noteName(data1)} vel ${data2}`);
    return;
  }

  if (command === 0x80 || (command === 0x90 && data2 === 0)) {
    stopNote(data1);
    logEvent(`CH${channel} NOTE OFF ${noteName(data1)}`);
    return;
  }

  if (command === 0xb0) {
    learn("cc", data1, data2);
    updateKnob(data1, data2);
    if (isVolumeControl(data1)) {
      setMasterVolume(data2);
      updateKnob(volumeCc, data2);
      macros[volumeMacroIndex].value = data2;
      saveMacros();
      renderMacros();
    } else {
      updateMacroValue("cc", data1, data2);
    }
    dom.note.textContent = `CC ${data1}`;
    dom.detail.textContent = `valeur ${data2}`;
    logEvent(`CH${channel} CC ${data1} = ${data2}`);
    return;
  }

  logEvent(`MIDI ${[...event.data].join(" ")}`);
}

function learn(type, number, value) {
  if (learnSlot === null) return;
  macros[learnSlot].type = type;
  macros[learnSlot].number = number;
  macros[learnSlot].value = value;
  learnSlot = null;
  saveMacros();
  renderMacros();
}

function updateMacroValue(type, number, value) {
  let changed = false;
  macros.forEach((macro) => {
    if (macro.type === type && macro.number === number) {
      macro.value = value;
      changed = true;
    }
  });
  if (changed) {
    saveMacros();
    renderMacros();
  }
}

function updateKnob(cc, value) {
  const knob = dom.knobBank.querySelector(`[data-cc="${cc}"]`);
  if (!knob) return;
  const degrees = Math.round((value / 127) * 270);
  knob.querySelector(".dial").style.setProperty("--turn", `${degrees}deg`);
}

function isVolumeControl(cc) {
  const volumeMacro = macros[volumeMacroIndex];
  return cc === volumeCc ||
    cc === standardVolumeCc ||
    (volumeMacro && volumeMacro.type === "cc" && volumeMacro.number === cc);
}

function selectProgram(padNote) {
  activeProgram = programs[padNote];
  dom.wave.value = activeProgram.wave;
  dom.note.textContent = activeProgram.name;
  dom.detail.textContent = `programme selectionne par ${noteName(padNote)}`;
  document.querySelectorAll(".pad").forEach((pad) => {
    pad.classList.toggle("is-program", Number(pad.dataset.note) === padNote);
  });
  logEvent(`PROGRAM ${activeProgram.name}`);
}

function setMasterVolume(midiValue) {
  ensureAudio();
  const percent = Math.round((midiValue / 127) * 100);
  dom.volume.value = String(percent);
  masterGain.gain.value = percent / 100;
  dom.audioState.textContent = `Volume ${percent}%`;
}

function highlight(selector, note, on) {
  const element = document.querySelector(`${selector}[data-note="${note}"]`);
  if (element) element.classList.toggle("is-on", on);
}

function playNote(note, velocity) {
  ensureAudio();
  audioContext.resume();

  if (activeVoices.has(note)) stopNote(note);

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const frequency = 440 * Math.pow(2, (note - 69) / 12);
  const program = activeProgram || programs[36];

  osc.type = program.wave || dom.wave.value;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.03, velocity / 127) * program.level, audioContext.currentTime + program.attack);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  activeVoices.set(note, { osc, gain });

  if (programs[note]) {
    dom.note.textContent = activeProgram.name;
    dom.detail.textContent = `programme ${activeProgram.name} · vel ${velocity}`;
  } else {
    dom.note.textContent = noteName(note);
    dom.detail.textContent = `note ${note} · vel ${velocity}`;
  }
  highlight(".key", note, true);
  highlight(".pad", note, true);
  updateMacroValue("note", note, velocity);
}

function stopNote(note) {
  const voice = activeVoices.get(note);
  if (!voice) return;
  const now = audioContext.currentTime;
  const program = activeProgram || programs[36];
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + program.release);
  voice.osc.stop(now + program.release + 0.02);
  activeVoices.delete(note);
  highlight(".key", note, false);
  highlight(".pad", note, false);
}

function exportPreset() {
  const blob = new Blob([JSON.stringify({ macros }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "mpk-mini-web-preset.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function importPreset(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.macros) || parsed.macros.length !== 8) throw new Error("preset invalide");
      parsed.macros.forEach((macro, index) => {
        macros[index] = macro;
      });
      saveMacros();
      renderMacros();
      logEvent("Preset importé");
    } catch (error) {
      logEvent("Import impossible");
    }
  };
  reader.readAsText(file);
}

dom.connect.addEventListener("click", connectMidi);
dom.inputSelect.addEventListener("change", () => {
  selectedInputId = dom.inputSelect.value;
  bindSelectedInput();
});
dom.volume.addEventListener("input", () => {
  ensureAudio();
  const percent = Number(dom.volume.value);
  masterGain.gain.value = percent / 100;
  dom.audioState.textContent = `Volume ${percent}%`;
});
dom.exportPreset.addEventListener("click", exportPreset);
dom.importPreset.addEventListener("change", () => {
  const file = dom.importPreset.files[0];
  if (file) importPreset(file);
});
dom.resetMap.addEventListener("click", () => {
  localStorage.removeItem(storageKey);
  const fresh = loadMacros();
  fresh.forEach((macro, index) => {
    macros[index] = macro;
  });
  learnSlot = null;
  renderMacros();
});
dom.clearLog.addEventListener("click", () => {
  dom.log.innerHTML = "";
});

renderController();
renderMacros();
updateInputs();
selectProgram(36);
