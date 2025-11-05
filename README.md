# Audiobook Player

An audio player meant for speech focused audio. 

---

## 🚀 Features
- Playback speed manipulation in realtime through tempo to prevent pitch alterations
- Rewinding using forward playing chunks
- Adjustable parameters
- leaky integrator to prevent sudden rapid shifts in playback speed

---

## 📦 How to use:

Method 1: Download all files, open index.html in your browser (double-click)

Method 2: Run a local static server. Download all files and then:
```
# In project folder
py -3 -m http.server 8000
# Then open http://localhost:8000 in browser
