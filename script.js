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
    const loopLengthInput = document.getElementById('loop-length');
    const loopDelayInput = document.getElementById('loop-delay');
    const rewindStepInput = document.getElementById('rewind-step');

    let audio = null;
    let currentAudio = null; //this is a url object
    let audioContext = null;
    let sourceNode = null;
    let gainNode = null;
    let isLooping = false;
    let loopStart = null;
    let loopEnd = null;
    let loopInterval = null;
    let loopRepetitionDelay = 0;

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
    //default to 5 seconds if no argument
    function rewind(seconds = 5) {
        if (!audio) return;
        audio.currentTime = Math.max(0, audio.currentTime - seconds);
    }

    function fastForward(seconds = 5) {
        if (!audio) return;
        audio.currentTime = Math.min(audio.duration, audio.currentTime + seconds);
    }

    function loopToggle() {
        if (!audio) return;
        
        isLooping = !isLooping;
        
        if (isLooping) {
            // Get loop length from input
            const loopLength = parseFloat(loopLengthInput?.value || 1);
            const halfLoop = loopLength / 2;
            
            //set loop to around current position (adjustable)
            loopStart = Math.max(0, audio.currentTime - halfLoop);
            loopEnd = Math.min(audio.duration, audio.currentTime + halfLoop);
            
            // Get delay from input
            loopRepetitionDelay = parseFloat(loopDelayInput?.value || 0);
            
            if (loopButton) loopButton.textContent = '🔁 Loop: ON';

            //if delay is not 0, start delay based loop
            if(loopRepetitionDelay > 0) {
               startIntervalLoop();
            }
        } else {
            loopStart = null;
            loopEnd = null;
            if (loopButton) loopButton.textContent = '🔁 Loop: OFF';

            //clear interval loop if any active
            if(loopInterval) {
                clearInterval(loopInterval);
                loopInterval = null;
            }
        }
    }

    //loop with delay
    function startIntervalLoop() {
        //clear previous delayed loop if any
        if(loopInterval) clearInterval(loopInterval);

        //get time for one loop
        const loopDuration = (loopEnd - loopStart) / audio.playbackRate;
        const totalCycleTime = (loopDuration + loopRepetitionDelay) * 1000; //in ms

        //jump to loop start
        audio.currentTime = loopStart;

        loopInterval = setInterval(() => {
            if (isLooping && audio.paused === false) {
                audio.currentTime = loopStart;
            }
        }, totalCycleTime);
    }

    function loadFile(file) {
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
            //add timeupdate listener for loop checking (continuous loop, no gap)
            audio.addEventListener('timeupdate', () => {
                if (isLooping && loopStart !== null && loopEnd !== null && loopRepetitionDelay === 0) {
                    if (audio.currentTime >= loopEnd) {
                        audio.currentTime = loopStart;
                    }
                }
            });
        } else {
            //pause before audio change
            audio.pause();
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

        currentAudio = URL.createObjectURL(file);
        audio.src = currentAudio;
        audio.playbackRate = parseFloat(speedSlider?.value || '1');
        if (currentFile) currentFile.textContent = file.name;
        if (playButton) playButton.disabled = false;
        if (rewindButton) rewindButton.disabled = false;
        if (fastForwardButton) fastForwardButton.disabled = false;
        if (loopButton) loopButton.disabled = false;
        
        //reset loop state
        isLooping = false;
        loopStart = null;
        loopEnd = null;
        if (loopInterval) clearInterval(loopInterval);
        loopInterval = null;
        if (loopButton) loopButton.textContent = '🔁 Loop: OFF';
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
            playAudio();
        }
    });

    //rewind button behavior
    rewindButton?.addEventListener('click', () => {
        rewind(rewindStepInput ? parseFloat(rewindStepInput.value) : 1); //rewind by user rewind step
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
        playbackRate = parseFloat(speedSlider.value || '1');
        setSpeedLabel(playbackRate);

        // Update playback rate for the current source
        if (currentSource) {
            currentSource.playbackRate.value = playbackRate;
        }
    });

    //initialize label for speed slider
    setSpeedLabel(parseFloat(speedSlider?.value || '1'));

    //cleanup object URL on unload
    window.addEventListener('beforeunload', () => {
        if (currentAudio) URL.revokeObjectURL(currentAudio);
        if (audioContext) audioContext.close();
        if (loopInterval) clearInterval(loopInterval);
    });
});