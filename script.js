document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const playButton = document.getElementById('play-button');
    const currentFile = document.getElementById('current-file');

    let audioContext = null;
    let audioBuffer = null;
    let currentSource = null;
    let playbackRate = 1; // Default playback rate

    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    async function loadFile(file) {
        if (!file) return;

        //stop current source and reset playback speed if one is being played already
        if(currentSource) {
            currentSource.stop();
            playbackRate = 1;
        }

        // initialize AudioContext if not already done
        if (!audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContext();
        }

        //decode audio data
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        //update UI on screen and set values to defaults
        if(currentFile) currentFile.textContent = file.name;
        if(playButton) playButton.disabled = false;
        if(speedSlider) speedSlider.value = '1';
        setSpeedLabel(1);
    }
    
    async function playAudio() {
        if (!audioBuffer || !audioContext) return;

        //resume the audio context if suspended
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        //stop current playback if playing already
        if(currentSource) {
            currentSource.stop();
        }

        //create a new buffer source
        currentSource = audioContext.createBufferSource();
        currentSource.buffer = audioBuffer;
        currentSource.playbackRate.value = playbackRate; //set to current speed on slider
        currentSource.connect(audioContext.destination);

        //start playback
        currentSource.start();
        playButton.textContent = 'Pause';

        //when playback ends, reset buttons
        currentSource.onended = () => {
            playButton.textContent = 'Play';
            currentSource = null;
        }
    }

    function pauseAudio() {
        if (currentSource) {
            currentSource.stop();
            currentSource = null;
            playButton.textContent = 'Play';
        }
    }

    //play/pause button behavior
    playButton?.addEventListener('click', () => {
        if (currentSource) {
            pauseAudio();
        } else {
            playAudio();
        }
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
        playbackRate = parseFloat(speedSlider.value || '1');
        setSpeedLabel(playbackRate);

        // Update playback rate for the current source
        if (currentSource) {
            currentSource.playbackRate.value = playbackRate;
        }
    });

    //initialize label for speed slider
    setSpeedLabel(parseFloat(speedSlider?.value || '1'));

    
});