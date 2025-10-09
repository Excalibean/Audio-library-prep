document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const playButton = document.getElementById('play-button');
    const rewindButton = document.getElementById('rewind-button');
    const fastForwardButton = document.getElementById('fast-forward-button');
    const loopButton = document.getElementById('loop-button');
    const currentFile = document.getElementById('current-file');

    let audio = null;
    let currentAudio = null; //this is a url object
    let audioContext = null;
    let sourceNode = null;
    let gainNode = null;

    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    //web audio api initialization
    function initWebAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (!gainNode) {
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
        }
        if (!sourceNode && audio) {
            sourceNode = audioContext.createMediaElementSource(audio);
            sourceNode.connect(gainNode);
        }
    }

    //temporal manipulation functions for audio
    function rewind(seconds = 5) {
        if (!audio) return;
        audio.currentTime = Math.max(0, audio.currentTime - seconds);
    }


    function fastForward(seconds = 5) {
        if (!audio) return;
        audio.currentTime = Math.min(audio.duration, audio.currentTime + seconds);
    }

    function loopToggle(seconds = 5) {
        if (!audio) return;
        audio.loop = !audio.loop;
    }

    function loadFile(file) {
        if (!file) return;
        // remove previous audio file (a URL object)
        if (currentAudio) {
            URL.revokeObjectURL(currentAudio);
            currentAudio = null;
        }

        //play button fucntionality
        if (!audio) {
            audio = new Audio();
            audio.preload = 'metadata';
            audio.addEventListener('ended', () => {
                if (playButton) playButton.textContent = 'Play';
            });
            audio.addEventListener('play', () => {
                if (playButton) playButton.textContent = 'Pause';
            });
            audio.addEventListener('pause', () => {
                if (playButton) playButton.textContent = 'Play';
            });
        } else {
            //pause before audio change
            audio.pause();
        }

        currentAudio = URL.createObjectURL(file);
        audio.src = currentAudio;
        audio.playbackRate = parseFloat(speedSlider?.value || '1');
        if (currentFile) currentFile.textContent = file.name;
        if (playButton) playButton.disabled = false;
        if (rewindButton) rewindButton.disabled = false;
        if (fastForwardButton) fastForwardButton.disabled = false;
        if (loopButton) loopButton.disabled = false;
    }

    //play/pause button behavior
    playButton?.addEventListener('click', () => {
        if (!audio) return;
        
        //initialize Web Audio API on first play (user interaction required)
        if (!audioContext) {
            initWebAudio();
        }
        
        if (audio.paused) {
            audio.play().catch(err => {
                console.error('Play failed:', err);
            });
        } else {
            audio.pause();
        }
    });

    //rewind button behavior
    rewindButton?.addEventListener('click', () => {
        rewind(1); // Rewind 1 second
    });

    loopButton?.addEventListener('click', () => {
        loopToggle();
    });

    fastForwardButton?.addEventListener('click', () => {
        fastForward(1); // Fast forward 1 second
    });

    //upload form
    uploadForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const files = fileInput.files;
        if (files && files.length) loadFile(files[0]); // load first selected file
    });

    //file selection
    fileInput?.addEventListener('change', () => {
        const files = fileInput.files;
        if (files && files.length) loadFile(files[0]);
    });


    //speed slider behavior
    speedSlider?.addEventListener('input', () => {
        const v = parseFloat(speedSlider.value || '1');
        setSpeedLabel(v);
        if (audio) audio.playbackRate = v;
    });

    //initialize label for speed slider
    setSpeedLabel(parseFloat(speedSlider?.value || '1'));

    //cleanup object URL on unload
    window.addEventListener('beforeunload', () => {
        if (currentAudio) URL.revokeObjectURL(currentAudio);
        if (audioContext) audioContext.close();
    });
});