document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const playButton = document.getElementById('play-button');
    const rewindButton = document.getElementById('rewind-button');
    const currentFile = document.getElementById('current-file');

    let audioContext = null;
    let audioBuffer = null;
    let currentSource = null;
    let playbackRate = 1; // Default playback rate
    let playbackPosition = 0;
    let startTime = 0;

    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    async function loadFile(file) {
        if (!file) return;

        //initialize AudioContext if not already done
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
        if(rewindButton) rewindButton.disabled = false;
        if(speedSlider) speedSlider.value = '1';
        setSpeedLabel(1);

        //reset playback position and speed
        playbackPosition = 0;
        playbackRate = 1;
    }

    function createSource(startFrom = 0) {
        //create a new AudioBufferSourceNode
        currentSource = audioContext.createBufferSource();
        currentSource.buffer = audioBuffer;
        currentSource.playbackRate.value = playbackRate;
        currentSource.connect(audioContext.destination);

        //start playback from the specified position
        currentSource.start(0, startFrom);
    }

    async function playAudio() {
        if (!audioBuffer || !audioContext) return;

        //resume the audio context if suspended
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        //stop the current source if it exists
        if (currentSource) {
            currentSource.stop();
            currentSource = null;
        }

        //start playback
        createSource(playbackPosition);
        startTime = audioContext.currentTime;
        playButton.textContent = 'Pause';
    }

    function pauseAudio() {
        if (audioContext.state === 'running') {
            //update playback position
            playbackPosition += audioContext.currentTime - startTime;

            audioContext.suspend().then(() => {
                playButton.textContent = 'Play';
            });
        }
    }

    function rewindAudio() {
        if (!audioBuffer || !audioContext) return;

        //if audio is playing, update the playback position
        if(currentSource && audioContext.state === 'running') {
            playbackPosition += audioContext.currentTime - startTime;
        }

        //rewind by 1 second
        playbackPosition = Math.max(0, playbackPosition - 1);

        //stop current playback
        if (currentSource) {
            currentSource.stop();
            currentSource = null;
        }

        //start playback from the rewound position
        createSource(playbackPosition);
        startTime = audioContext.currentTime;
        playButton.textContent = 'Pause';
    }

    //play/pause button behavior
    playButton.addEventListener('click', () => {
        if (audioContext.state === 'running') {
            pauseAudio();
        } else {
            playAudio();
        }
    });

    //rewind button behavior
    rewindButton.addEventListener('click', () => {
        rewindAudio();
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