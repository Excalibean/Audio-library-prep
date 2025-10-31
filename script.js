document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const playButton = document.getElementById('play-button');
    const rewindButton = document.getElementById('rewind-button');
    const fastForwardButton = document.getElementById('fast-forward-button');
    const currentFile = document.getElementById('current-file');
    const rewindStepInput = document.getElementById('rewind-step');
    const rewindStepLabel = document.getElementById('rewind-step-label');
    const rewindFreq = document.getElementById('rewind-freq');
    const rewindFreqLabel = document.getElementById('rewind-freq-label');
    const rewindOverlap = document.getElementById('rewind-overlap');
    const rewindOverlapLabel = document.getElementById('rewind-overlap-label');
    const rewindPlaybackSpeed = document.getElementById('rewind-playback-speed');
    const rewindPlaybackSpeedLabel = document.getElementById('rewind-playback-speed-label');
    const progressBar = document.getElementById('progress-bar');
    const currentTimeDisplay = document.getElementById('current-time');
    const durationTimeDisplay = document.getElementById('duration-time');

    let audio = null;
    let currentAudio = null; //this is a url object
    let audioContext = null;
    let rewindInterval = null; // For continuous rewinding
    let audioBuffer = null; // Store decoded audio for Web Audio API playback
    let isSeeking = false; // Track if user is dragging the progress bar
    let isRewinding = false; // Track if currently in rewind mode
    let wasPlayingBeforeRewind = false; // Track play state before rewinding
    const FADE_TIME = 0.04; // 40ms fade in/out to prevent clicks
    const DEFAULT_TRACK = 'default_audiobook.mp3'; //default audio file path

    //TO DO: add second slider for equilibrium point using formula below (lock the clockspeed to reduce varation)
    // note: low pass filter eq: dX/dt = -gamma(X - E(t)) where E(t) is time (equilibrium point) and gamma is how quick it converges
    //                            or simply put in code: X = X - alpha * (X - E)

    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    // Format time in MM:SS format
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Update progress bar and time display
    function updateProgress() {
        if (!audio || isSeeking) return;
        
        const progress = (audio.currentTime / audio.duration) * 100;
        if (progressBar) progressBar.value = progress;
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(audio.currentTime);
        if (durationTimeDisplay) durationTimeDisplay.textContent = formatTime(audio.duration);
    }

    // Update parameter labels
    function updateParameterLabels() {
        if (rewindStepLabel) rewindStepLabel.textContent = `${parseFloat(rewindStepInput.value).toFixed(2)}s`;
        if (rewindFreqLabel) rewindFreqLabel.textContent = `${parseFloat(rewindFreq.value).toFixed(2)}s`;
        if (rewindOverlapLabel) rewindOverlapLabel.textContent = `${parseFloat(rewindOverlap.value).toFixed(2)}s`;
        if (rewindPlaybackSpeedLabel) rewindPlaybackSpeedLabel.textContent = `${parseFloat(rewindPlaybackSpeed.value).toFixed(2)}x`;
    }

    //web audio api initialization - only when needed for rewinding
    function initWebAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
        
        // Remember if audio was playing before rewind
        wasPlayingBeforeRewind = !audio.paused;
        isRewinding = true;
        
        // Initialize Web Audio API for chunk playback
        if (!audioContext) {
            initWebAudio();
        }
        
        // Pause the main audio element during rewinding
        if (!audio.paused) {
            audio.pause();
        }
        
        // Update play button text
        if (playButton) playButton.textContent = 'Pause';
        
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
            // Update progress bar during playback
            audio.addEventListener('timeupdate', updateProgress);
            // Update duration display when metadata is loaded
            audio.addEventListener('loadedmetadata', () => {
                updateProgress();
                if (progressBar) progressBar.max = 100;
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
            // Update progress bar during playback
            audio.addEventListener('timeupdate', updateProgress);
            // Update duration display when metadata is loaded
            audio.addEventListener('loadedmetadata', () => {
                updateProgress();
                if (progressBar) progressBar.max = 100;
            });

        }

        audio.src = DEFAULT_TRACK;
        audio.playbackRate = parseFloat(speedSlider?.value || '1');
        if (currentFile) currentFile.textContent = 'Default Track';
        if (playButton) playButton.disabled = false;
        if (rewindButton) rewindButton.disabled = false;
        if (fastForwardButton) fastForwardButton.disabled = false;

        // Fetch and decode default track for Web Audio API
        fetch(DEFAULT_TRACK)
            .then(response => response.arrayBuffer())
            .then(decodeAudioFile)
            .catch(err => console.error('Error loading default track:', err));
    }

    //play/pause button behavior
    playButton?.addEventListener('click', () => {
        if (!audio) return;
        
        const currentSpeed = parseFloat(speedSlider?.value || '1');
        
        if (currentSpeed < 0) {
            //if speed slider in rewind mode, play/pause in rewind mode
            if (rewindInterval) {
                //if in rewind - pause it
                stopContinuousRewind();
                wasPlayingBeforeRewind = false;
                if (playButton) playButton.textContent = 'Play';
            } else {
                //if in rewind mode - resume rewinding
                startContinuousRewind(currentSpeed);
                wasPlayingBeforeRewind = true;
                if (playButton) playButton.textContent = 'Pause';
            }
        } else {
            //if in positive/forward playback mode, normal play/pause
            if (audio.paused) {
                audio.play().catch(err => {
                    console.error('Play failed:', err);
                });
            } else {
                audio.pause();
            }
        }
    });

    //rewind button behavior
    rewindButton?.addEventListener('click', () => {
        rewind(rewindStepInput ? parseFloat(rewindStepInput.value) : 1); //rewind by user rewind step
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
                if (!audio.paused || rewindInterval) {
                    startContinuousRewind(v);
                }
            } else {
                // Positive speed: stop rewind and set playback rate
                const wasRewindingActive = rewindInterval !== null;
                stopContinuousRewind();
                audio.playbackRate = v;
                
                // Resume forward playback if we were actively rewinding
                if (wasRewindingActive) {
                    //small delay to ensure audio is ready
                    setTimeout(() => {
                        audio.play().catch(err => {
                            console.error('Play failed:', err);
                        });
                    }, 10);
                    if (playButton) playButton.textContent = 'Pause';
                }
            }
        }
    });

    // Progress bar seeking
    progressBar?.addEventListener('mousedown', () => {
        isSeeking = true;
    });

    progressBar?.addEventListener('mouseup', () => {
        isSeeking = false;
    });

    progressBar?.addEventListener('input', () => {
        if (!audio) return;
        const seekTime = (progressBar.value / 100) * audio.duration;
        audio.currentTime = seekTime;
        updateProgress();
    });

    // Add event listeners for parameter sliders
    rewindStepInput?.addEventListener('input', updateParameterLabels);
    rewindFreq?.addEventListener('input', updateParameterLabels);
    rewindOverlap?.addEventListener('input', updateParameterLabels);
    rewindPlaybackSpeed?.addEventListener('input', updateParameterLabels);

    //initialize labels
    setSpeedLabel(parseFloat(speedSlider?.value || '1'));
    updateParameterLabels();

    // Load default track on page load
    loadDefaultTrack();

    //cleanup object URL on unload
    window.addEventListener('beforeunload', () => {
        if (currentAudio) URL.revokeObjectURL(currentAudio);
        if (audioContext) audioContext.close();
        if (rewindInterval) clearInterval(rewindInterval);
    });
});