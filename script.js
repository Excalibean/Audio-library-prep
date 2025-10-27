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
    const rewindPlaybackSpeed = document.getElementById('rewind-playback-speed'); //playback tempo while rewinding

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

    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    //web audio api initialization - only when needed for rewinding
    function initWebAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // Connect audio element to Web Audio API (for looping with fades)
    function connectAudioElement() {
        if (!audioContext || !audio) return;
        
        if (!gainNode) {
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
        }
        
        if (!sourceNode) {
            try {
                sourceNode = audioContext.createMediaElementSource(audio);
                sourceNode.connect(gainNode);
            } catch (err) {
                console.error('Error connecting audio element:', err);
            }
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

    // Pitch-preserving tempo adjustment using overlap-add technique
    function createTempoStretchedBuffer(sourceBuffer, tempoFactor) {
        if (!audioContext || !sourceBuffer) return null;
        
        // If tempo is 1.0, return original buffer
        if (Math.abs(tempoFactor - 1.0) < 0.01) return sourceBuffer;
        
        const sampleRate = sourceBuffer.sampleRate;
        const numberOfChannels = sourceBuffer.numberOfChannels;
        const originalLength = sourceBuffer.length;
        // FIX: Multiply by tempoFactor instead of dividing
        // tempoFactor > 1 = faster/shorter, tempoFactor < 1 = slower/longer
        const newLength = Math.floor(originalLength / tempoFactor);
        
        // Create new buffer for stretched audio
        const stretchedBuffer = audioContext.createBuffer(
            numberOfChannels,
            newLength,
            sampleRate
        );
        
        const windowSize = Math.floor(sampleRate * 0.04); // 40ms window
        const hopSize = Math.floor(windowSize / 2);
        // FIX: Divide by tempoFactor instead of multiplying
        const outputHopSize = Math.floor(hopSize / tempoFactor);
        
        // Process each channel
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const inputData = sourceBuffer.getChannelData(channel);
            const outputData = stretchedBuffer.getChannelData(channel);
            
            let inputPos = 0;
            let outputPos = 0;
            
            // Overlap-add processing
            while (inputPos + windowSize < originalLength && outputPos < newLength) {
                // Copy and apply Hann window
                for (let i = 0; i < windowSize && outputPos + i < newLength; i++) {
                    const hannWindow = 0.5 * (1 - Math.cos(2 * Math.PI * i / windowSize));
                    const sample = inputData[inputPos + i] * hannWindow;
                    outputData[outputPos + i] = (outputData[outputPos + i] || 0) + sample;
                }
                
                inputPos += hopSize;
                outputPos += outputHopSize;
            }
            
            // Normalize output to prevent clipping
            let maxAmplitude = 0;
            for (let i = 0; i < newLength; i++) {
                maxAmplitude = Math.max(maxAmplitude, Math.abs(outputData[i]));
            }
            if (maxAmplitude > 1.0) {
                for (let i = 0; i < newLength; i++) {
                    outputData[i] /= maxAmplitude;
                }
            }
        }
        
        return stretchedBuffer;
    }

    // Play an overlapping audio chunk using Web Audio API with tempo stretching
    function playOverlappingChunk(startTime, duration, overlap) {
        if (!audioContext || !audioBuffer) return;

        const tempoFactor = parseFloat(rewindPlaybackSpeed?.value || 1);
        
        // Extract chunk from main buffer
        const startSample = Math.floor(startTime * audioBuffer.sampleRate);
        const durationSamples = Math.floor(duration * audioBuffer.sampleRate);
        const numberOfChannels = audioBuffer.numberOfChannels;
        
        // Ensure we don't exceed buffer bounds
        const actualDurationSamples = Math.min(durationSamples, audioBuffer.length - startSample);
        if (actualDurationSamples <= 0) return;
        
        // Create buffer for the chunk
        const chunkBuffer = audioContext.createBuffer(
            numberOfChannels,
            actualDurationSamples,
            audioBuffer.sampleRate
        );
        
        // Copy chunk data
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const sourceData = audioBuffer.getChannelData(channel);
            const chunkData = chunkBuffer.getChannelData(channel);
            
            for (let i = 0; i < actualDurationSamples; i++) {
                const sourceIndex = startSample + i;
                if (sourceIndex < sourceData.length) {
                    chunkData[i] = sourceData[sourceIndex];
                }
            }
        }
        
        // Apply tempo stretching while preserving pitch
        const stretchedBuffer = createTempoStretchedBuffer(chunkBuffer, tempoFactor);
        
        if (!stretchedBuffer) return;
        
        // Create buffer source for playback
        const chunkSource = audioContext.createBufferSource();
        chunkSource.buffer = stretchedBuffer;
        
        // Create gain node for crossfading
        const chunkGain = audioContext.createGain();
        chunkSource.connect(chunkGain);
        chunkGain.connect(audioContext.destination);
        
        const now = audioContext.currentTime;
        const fadeDuration = Math.min(overlap / 2, FADE_TIME);
        const chunkDuration = stretchedBuffer.duration;
        
        // Fade in at start
        chunkGain.gain.setValueAtTime(0, now);
        chunkGain.gain.linearRampToValueAtTime(1, now + fadeDuration);
        
        // Fade out at end
        const fadeOutStart = now + chunkDuration - fadeDuration;
        if (fadeOutStart > now) {
            chunkGain.gain.setValueAtTime(1, fadeOutStart);
            chunkGain.gain.linearRampToValueAtTime(0, now + chunkDuration);
        }
        
        // Play the tempo-stretched chunk
        chunkSource.start(now);
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
        
        // Initialize Web Audio API for chunk playback
        if (!audioContext) {
            initWebAudio();
        }
        
        // Pause the main audio element during rewinding
        if (!audio.paused) {
            audio.pause();
        }
        
        const rewindSpeed = Math.abs(speed); //convert negative to positive to match slider
        const stepSize = parseFloat(rewindStepInput?.value || 1); // Chunk size and step distance
        const overlap = parseFloat(rewindOverlap?.value || 0.2); // Overlap in seconds
        const frequency = parseFloat(rewindFreq?.value || 0.5); // How often to step back
        
        const intervalTime = (frequency / rewindSpeed) * 1000; // Adjust frequency to speed
        
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
            
            // Move the playhead back to create rewind effect
            audio.currentTime = Math.max(0, audio.currentTime - stepSize);
            
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

            // Initialize and connect Web Audio for fade effects
            if (!audioContext) {
                initWebAudio();
            }
            connectAudioElement();

            //apply fade in when starting loop
            if (gainNode) {
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