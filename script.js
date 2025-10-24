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
    const rewindFreq = document.getElementById('rewind-freq');       //how often to step back
    const rewindOverlap = document.getElementById('rewind-overlap'); //audio overlap between steps
    const rewindPlaybackSpeed = document.getElementById('rewind-playback-speed'); //playback speed while rewinding

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
    let rewindInterval = null; // For continuous rewinding
    let isRewinding = false; // Track if currently in rewind mode
    let audioBuffer = null; // Store decoded audio for Web Audio API playback
    const FADE_TIME = 0.04; // 40ms fade in/out to prevent clicks
    const DEFAULT_TRACK = 'default_audiobook.mp3'; //default audio file path

    //TO DO: rewind playback speed control (currently not tempo, must be tempo)

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

    //apply fade in/out to prevent clicks
    function applyFade(fadeIn = true) {
        if (!gainNode || !audioContext) return;
        
        const now = audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        
        if (fadeIn) {
            // Fade in from 0 to 1 over FADE_TIME
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(1, now + FADE_TIME);
        } else {
            // Fade out from current to 0 over FADE_TIME
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + FADE_TIME);
        }
    }

    // Play an overlapping audio chunk using Web Audio API
    function playOverlappingChunk(startTime, duration, overlap) {
        if (!audioContext || !audioBuffer) return;

        const playbackSpeed = parseFloat(rewindPlaybackSpeed?.value || 1);
        
        // Create a new buffer source for this chunk
        const chunkSource = audioContext.createBufferSource();
        chunkSource.buffer = audioBuffer;
        
        // Create a gain node for this chunk to control crossfading
        const chunkGain = audioContext.createGain();
        chunkSource.connect(chunkGain);
        chunkGain.connect(audioContext.destination);
        
        // Set playback rate
        chunkSource.playbackRate.value = playbackSpeed;
        
        const now = audioContext.currentTime;
        const fadeDuration = Math.min(overlap / 2, FADE_TIME);
        
        // Fade in at the start
        chunkGain.gain.setValueAtTime(0, now);
        chunkGain.gain.linearRampToValueAtTime(1, now + fadeDuration);
        
        // Fade out at the end
        const chunkDuration = duration / playbackSpeed;
        chunkGain.gain.setValueAtTime(1, now + chunkDuration - fadeDuration);
        chunkGain.gain.linearRampToValueAtTime(0, now + chunkDuration);
        
        // Play the chunk
        chunkSource.start(now, startTime, duration);
        chunkSource.stop(now + chunkDuration);
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

    //start continuous rewinding based on negative speed with overlapping chunks
    function startContinuousRewind(speed) {
        // stop existing rewind interval
        stopContinuousRewind();
        
        if (!audio || speed >= 0) return;
        
        isRewinding = true;
        
        // Pause the main audio element during rewinding
        if (!audio.paused) {
            audio.pause();
        }
        
        const rewindSpeed = Math.abs(speed); //convert negative to positive to match slider
        const stepSize = parseFloat(rewindStepInput?.value || 1); // Chunk size and step distance
        const overlap = parseFloat(rewindOverlap?.value || 0.2); // Overlap in seconds
        const frequency = parseFloat(rewindFreq?.value || 0.5); // How often to step back
        
        const intervalTime = (frequency / rewindSpeed) * 1000; // Adjust frequency by speed
        
        rewindInterval = setInterval(() => {
            if (!audio || audio.currentTime <= 0) {
                stopContinuousRewind();
                //reset slider to 1x when reaching the beginning
                if (speedSlider) {
                    speedSlider.value = '1';
                    setSpeedLabel(1);
                    if (audio) audio.playbackRate = 1;
                }
                return;
            }
            
            // Calculate the start position for the chunk
            const chunkStart = Math.max(0, audio.currentTime - stepSize);
            
            // Play overlapping chunk using Web Audio API
            if (audioBuffer) {
                playOverlappingChunk(chunkStart, stepSize, overlap);
            }
            
            // Move the playhead back by stepSize minus overlap
            audio.currentTime = Math.max(0, audio.currentTime - (stepSize - overlap));
            
        }, intervalTime);
    }

    // Stop continuous rewinding
    function stopContinuousRewind() {
        if (rewindInterval) {
            clearInterval(rewindInterval);
            rewindInterval = null;
        }
        isRewinding = false;
    }

    function loopToggle() {
        if (!audio) return;
        
        isLooping = !isLooping;
        
        if (isLooping) {
            //get loop length from input
            const loopLength = parseFloat(loopLengthInput?.value || 1);
            const halfLoop = loopLength / 2;
            
            //set loop to around current position (adjustable)
            loopStart = Math.max(0, audio.currentTime - halfLoop);
            loopEnd = Math.min(audio.duration, audio.currentTime + halfLoop);
            
            //get delay from input
            loopRepetitionDelay = parseFloat(loopDelayInput?.value || 0);
            
            if (loopButton) loopButton.textContent = '🔁 Loop: ON';

            //apply fade in when starting loop
            if (audioContext && gainNode) {
                applyFade(true);
            }

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
                //apply fade in before jumping to loop start
                if (audioContext && gainNode) {
                    applyFade(true);
                }
                audio.currentTime = loopStart;
            }
        }, totalCycleTime);
    }

    // Decode audio file into buffer for Web Audio API
    async function decodeAudioFile(arrayBuffer) {
        if (!audioContext) {
            initWebAudio();
        }
        try {
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } catch (err) {
            console.error('Error decoding audio:', err);
        }
    }

    function loadFile(file) {
        if (!file) return;
        //remove previous audio file (a URL object)
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
            //add timeupdate listener for loop checking (continuous loop, no gap)
            audio.addEventListener('timeupdate', () => {
                if (isLooping && loopStart !== null && loopEnd !== null && loopRepetitionDelay === 0) {
                    // Check if we're near the end of the loop (within fade time)
                    if (audio.currentTime >= loopEnd - FADE_TIME) {
                        // Apply fade out before looping
                        if (audioContext && gainNode && audio.currentTime >= loopEnd - FADE_TIME && audio.currentTime < loopEnd) {
                            applyFade(false);
                        }
                    }
                    
                    if (audio.currentTime >= loopEnd) {
                        audio.currentTime = loopStart;
                        // Apply fade in after jumping back
                        if (audioContext && gainNode) {
                            applyFade(true);
                        }
                    }
                }
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
        
        //reset loop state
        isLooping = false;
        loopStart = null;
        loopEnd = null;
        if (loopInterval) clearInterval(loopInterval);
        loopInterval = null;
        if (loopButton) loopButton.textContent = '🔁 Loop: OFF';

        // Decode audio for Web Audio API (for overlapping chunks)
        file.arrayBuffer().then(decodeAudioFile);
    }

    // Load default track from URL
    function loadDefaultTrack() {
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
            //add timeupdate listener for loop checking (continuous loop, no gap)
            audio.addEventListener('timeupdate', () => {
                if (isLooping && loopStart !== null && loopEnd !== null && loopRepetitionDelay === 0) {
                    // Check if we're near the end of the loop (within fade time)
                    if (audio.currentTime >= loopEnd - FADE_TIME) {
                        // Apply fade out before looping
                        if (audioContext && gainNode && audio.currentTime >= loopEnd - FADE_TIME && audio.currentTime < loopEnd) {
                            applyFade(false);
                        }
                    }
                    
                    if (audio.currentTime >= loopEnd) {
                        audio.currentTime = loopStart;
                        // Apply fade in after jumping back
                        if (audioContext && gainNode) {
                            applyFade(true);
                        }
                    }
                }
            });
        }

        audio.src = DEFAULT_TRACK;
        audio.playbackRate = parseFloat(speedSlider?.value || '1');
        if (currentFile) currentFile.textContent = 'Default Track';
        if (playButton) playButton.disabled = false;
        if (rewindButton) rewindButton.disabled = false;
        if (fastForwardButton) fastForwardButton.disabled = false;
        if (loopButton) loopButton.disabled = false;

        // Fetch and decode default track for Web Audio API
        fetch(DEFAULT_TRACK)
            .then(response => response.arrayBuffer())
            .then(decodeAudioFile)
            .catch(err => console.error('Error loading default track:', err));
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
        const v = parseFloat(speedSlider.value || '1');
        setSpeedLabel(v);
        
        if (audio) {
            if (v < 0) {
                // Negative speed: start continuous rewind
                startContinuousRewind(v);
            } else {
                // Positive speed: stop rewind and set playback rate
                stopContinuousRewind();
                audio.playbackRate = v;
            }
        }
    });

    //initialize label for speed slider
    setSpeedLabel(parseFloat(speedSlider?.value || '1'));

    // Load default track on page load
    loadDefaultTrack();

    //cleanup object URL on unload
    window.addEventListener('beforeunload', () => {
        if (currentAudio) URL.revokeObjectURL(currentAudio);
        if (audioContext) audioContext.close();
        if (loopInterval) clearInterval(loopInterval);
        if (rewindInterval) clearInterval(rewindInterval);
    });
});