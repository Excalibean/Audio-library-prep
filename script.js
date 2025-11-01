document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const playButton = document.getElementById('play-button');
    const rewindButton = document.getElementById('rewind-button');
    const fastForwardButton = document.getElementById('fast-forward-button');
    const currentFile = document.getElementById('current-file');
    const chunkSizeInput = document.getElementById('chunk-size');
    const chunkSizeLabel = document.getElementById('chunk-size-label');
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
    let currentAudio = null;
    let audioContext = null;
    let rewindInterval = null;
    let audioBuffer = null;
    let isSeeking = false;
    let isRewinding = false;
    let wasPlayingBeforeRewind = false;
    
    const FADE_TIME = 0.04;
    const DEFAULT_TRACK = 'default_audiobook.mp3';

    //TO DO: add second slider for equilibrium point using formula below (lock the clockspeed to reduce varation)
    // note: low pass filter eq: dX/dt = -gamma(X - E(t)) where E(t) is time (equilibrium point) and gamma is how quick it converges
    //                            or simply put in code: X = X - alpha * (X - E)

    // Helper functions
    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    //timestamp and progress bar
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function updateProgress() {
        if (!audio) return;
        const progress = (audio.currentTime / audio.duration) * 100;
        if (progressBar && !isSeeking) progressBar.value = progress; // Only update bar if not seeking
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(audio.currentTime);
        if (durationTimeDisplay) durationTimeDisplay.textContent = formatTime(audio.duration);
    }

    //parameter labels in real-time
    function updateParameterLabels() {
        const currentSpeed = Math.abs(parseFloat(speedSlider?.value || '1'));
        const isNegative = parseFloat(speedSlider?.value || '1') < 0;
        
        const chunkMultiplier = parseFloat(chunkSizeInput?.value || 1);
        const stepMultiplier = parseFloat(rewindStepInput?.value || 1);
        const baseFreq = parseFloat(rewindFreq?.value || 0.5);
        const baseOverlap = parseFloat(rewindOverlap?.value || 0.2);
        const basePlaybackSpeed = parseFloat(rewindPlaybackSpeed?.value || 1);
        
        if (isNegative && currentSpeed > 0) {
            // Calculate actual values being used during rewind
            const actualInterval = baseFreq / currentSpeed;
            const baseChunkDuration = actualInterval + baseOverlap;
            const actualChunkDuration = baseChunkDuration * chunkMultiplier;
            const actualStep = actualInterval * stepMultiplier;
            
            if (chunkSizeLabel) {
                chunkSizeLabel.textContent = `${chunkMultiplier.toFixed(2)}x (actual: ${actualChunkDuration.toFixed(2)}s)`;
            }
            if (rewindStepLabel) {
                rewindStepLabel.textContent = `${stepMultiplier.toFixed(2)}x (actual: ${actualStep.toFixed(2)}s)`;
            }
            if (rewindFreqLabel) {
                rewindFreqLabel.textContent = `${baseFreq.toFixed(2)}s (interval: ${actualInterval.toFixed(2)}s)`;
            }
            if (rewindOverlapLabel) {
                rewindOverlapLabel.textContent = `${baseOverlap.toFixed(2)}s`;
            }
        } else {
            // Show base values when not rewinding
            if (chunkSizeLabel) {
                chunkSizeLabel.textContent = `${chunkMultiplier.toFixed(2)}x`;
            }
            if (rewindStepLabel) {
                rewindStepLabel.textContent = `${stepMultiplier.toFixed(2)}x`;
            }
            if (rewindFreqLabel) {
                rewindFreqLabel.textContent = `${baseFreq.toFixed(2)}s`;
            }
            if (rewindOverlapLabel) {
                rewindOverlapLabel.textContent = `${baseOverlap.toFixed(2)}s`;
            }
        }
        
        if (rewindPlaybackSpeedLabel) {
            rewindPlaybackSpeedLabel.textContent = `${basePlaybackSpeed.toFixed(2)}x`;
        }
    }

    function initWebAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // Tempo stretching using overlap-add technique
    function createTempoStretchedBuffer(sourceBuffer, tempoFactor) {
        if (!audioContext || !sourceBuffer || Math.abs(tempoFactor - 1.0) < 0.01) {
            return sourceBuffer;
        }
        
        const sampleRate = sourceBuffer.sampleRate;
        const numberOfChannels = sourceBuffer.numberOfChannels;
        const originalLength = sourceBuffer.length;
        const newLength = Math.floor(originalLength / tempoFactor);
        
        //buffer for audio manipulation (hopSize is original audio step for tempo change)
        const stretchedBuffer = audioContext.createBuffer(numberOfChannels, newLength, sampleRate);
        const windowSize = Math.floor(sampleRate * 0.04);
        const hopSize = Math.floor(windowSize / 2);
        const outputHopSize = Math.floor(hopSize / tempoFactor);
        
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const inputData = sourceBuffer.getChannelData(channel);
            const outputData = stretchedBuffer.getChannelData(channel);
            let inputPos = 0;
            let outputPos = 0;
            
            //windowing using Hann window
            while (inputPos + windowSize < originalLength && outputPos < newLength) {
                for (let i = 0; i < windowSize && outputPos + i < newLength; i++) {
                    const hannWindow = 0.5 * (1 - Math.cos(2 * Math.PI * i / windowSize));
                    const sample = inputData[inputPos + i] * hannWindow;
                    outputData[outputPos + i] = (outputData[outputPos + i] || 0) + sample;
                }
                inputPos += hopSize;
                outputPos += outputHopSize;
            }
            
            // Normalize to prevent clipping
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

    //chunking and overlapping playback
    function playOverlappingChunk(startTime, duration, overlap) {
        if (!audioContext || !audioBuffer) return;

        const tempoFactor = parseFloat(rewindPlaybackSpeed?.value || 1);
        const startSample = Math.floor(startTime * audioBuffer.sampleRate);
        const durationSamples = Math.floor(duration * audioBuffer.sampleRate);
        const actualDurationSamples = Math.min(durationSamples, audioBuffer.length - startSample);
        
        if (actualDurationSamples <= 0) return;
        
        // Create and copy chunk buffer
        const chunkBuffer = audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            actualDurationSamples,
            audioBuffer.sampleRate
        );
        
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const sourceData = audioBuffer.getChannelData(channel);
            const chunkData = chunkBuffer.getChannelData(channel);
            chunkData.set(sourceData.subarray(startSample, startSample + actualDurationSamples));
        }
        
        const stretchedBuffer = createTempoStretchedBuffer(chunkBuffer, tempoFactor);
        if (!stretchedBuffer) return;
        
        // Setup playback with crossfade
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = stretchedBuffer;
        source.connect(gain).connect(audioContext.destination);
        
        const now = audioContext.currentTime;
        const fadeDuration = Math.min(overlap / 2, FADE_TIME);
        const chunkDuration = stretchedBuffer.duration;
        
        // Fade in/out to prevent clicks
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + fadeDuration);
        
        const fadeOutStart = now + chunkDuration - fadeDuration;
        if (fadeOutStart > now) {
            gain.gain.setValueAtTime(1, fadeOutStart);
            gain.gain.linearRampToValueAtTime(0, now + chunkDuration);
        }
        
        source.start(now);
        source.stop(now + chunkDuration);
    }

    //rewinding functions
    function startContinuousRewind(speed) {
        stopContinuousRewind();
        //check for rewinding condition: negative speed
        if (!audio || speed >= 0) return;
        
        //pause forward playback and mark as rewinding
        wasPlayingBeforeRewind = !audio.paused;
        isRewinding = true;
        
        if (!audioContext) initWebAudio();
        if (!audio.paused) audio.pause();
        if (playButton) playButton.textContent = 'Pause';
        
        const executeRewind = () => {
            if (!audio || audio.currentTime <= 0) {
                stopContinuousRewind();
                if (speedSlider) {
                    speedSlider.value = '1';
                    setSpeedLabel(1);
                    if (audio) audio.playbackRate = 1;
                }
                updateParameterLabels();
                return;
            }
            
            //parameters for speedslider, period, and overlap duration
            const currentSpeed = Math.abs(parseFloat(speedSlider?.value || '1'));
            const baseFrequency = parseFloat(rewindFreq?.value || 0.5);
            const overlap = parseFloat(rewindOverlap?.value || 0.2);
            const chunkMultiplier = parseFloat(chunkSizeInput?.value || 1);
            const stepMultiplier = parseFloat(rewindStepInput?.value || 1);
            
            // Calculate dynamic parameters with separate multipliers
            const interval = baseFrequency / currentSpeed;
            const stepSize = interval * stepMultiplier; // How far playhead moves
            const baseChunkDuration = interval + overlap;
            const chunkDuration = baseChunkDuration * chunkMultiplier; // How long audio chunk is
            
            //get start of chunk to play
            const chunkStart = Math.max(0, audio.currentTime - chunkDuration);
            
            if (audioBuffer) {
                playOverlappingChunk(chunkStart, chunkDuration, overlap);
            }
            
            audio.currentTime = Math.max(0, audio.currentTime - stepSize);
            updateParameterLabels();
            
            rewindInterval = setTimeout(executeRewind, interval * 1000);
        };
        
        executeRewind();
    }

    function stopContinuousRewind() {
        if (rewindInterval) {
            clearTimeout(rewindInterval);
            rewindInterval = null;
        }
        isRewinding = false;
        updateParameterLabels();
    }

    //file management and loading audio
    async function decodeAudioFile(arrayBuffer) {
        if (!audioContext) initWebAudio();
        try {
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } catch (err) {
            console.error('Error decoding audio:', err);
        }
    }

    function setupAudioElement() {
        if (audio) return;
        
        audio = new Audio();
        audio.preload = 'metadata';
        
        audio.addEventListener('ended', () => {
            if (!isRewinding && playButton) playButton.textContent = 'Play';
        });
        audio.addEventListener('play', () => {
            if (!isRewinding && playButton) playButton.textContent = 'Pause';
        });
        audio.addEventListener('pause', () => {
            if (!isRewinding && playButton) playButton.textContent = 'Play';
        });
        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', () => {
            updateProgress();
            if (progressBar) progressBar.max = 100;
        });
    }

    function loadFile(file) {
        if (!file) return;
        
        if (currentAudio) {
            URL.revokeObjectURL(currentAudio);
            currentAudio = null;
        }

        setupAudioElement();
        if (audio) audio.pause();

        currentAudio = URL.createObjectURL(file);
        audio.src = currentAudio;
        audio.playbackRate = parseFloat(speedSlider?.value || '1');
        
        if (currentFile) currentFile.textContent = file.name;
        [playButton, rewindButton, fastForwardButton].forEach(btn => {
            if (btn) btn.disabled = false;
        });

        file.arrayBuffer().then(decodeAudioFile);
    }

    function loadDefaultTrack() {
        setupAudioElement();
        
        audio.src = DEFAULT_TRACK;
        audio.playbackRate = parseFloat(speedSlider?.value || '1');
        
        if (currentFile) currentFile.textContent = 'Default Track';
        [playButton, rewindButton, fastForwardButton].forEach(btn => {
            if (btn) btn.disabled = false;
        });

        fetch(DEFAULT_TRACK)
            .then(response => response.arrayBuffer())
            .then(decodeAudioFile)
            .catch(err => console.error('Error loading default track:', err));
    }

    // Event Listeners
    playButton?.addEventListener('click', () => {
        if (!audio) return;
        
        const currentSpeed = parseFloat(speedSlider?.value || '1');
        
        if (currentSpeed < 0) {
            if (rewindInterval) {
                stopContinuousRewind();
                wasPlayingBeforeRewind = false;
                if (playButton) playButton.textContent = 'Play';
            } else {
                startContinuousRewind(currentSpeed);
                wasPlayingBeforeRewind = true;
                if (playButton) playButton.textContent = 'Pause';
            }
        } else {
            audio.paused ? audio.play().catch(console.error) : audio.pause();
        }
    });

    rewindButton?.addEventListener('click', () => {
        if (!audio) return;
        const stepMultiplier = parseFloat(rewindStepInput?.value || 1);
        audio.currentTime = Math.max(0, audio.currentTime - stepMultiplier);
    });

    fastForwardButton?.addEventListener('click', () => {
        if (!audio) return;
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 1);
    });

    uploadForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (fileInput?.files?.length) loadFile(fileInput.files[0]);
    });

    fileInput?.addEventListener('change', () => {
        if (fileInput?.files?.length) loadFile(fileInput.files[0]);
    });

    speedSlider?.addEventListener('input', () => {
        const v = parseFloat(speedSlider.value || '1');
        setSpeedLabel(v);
        updateParameterLabels();
        
        if (!audio) return;
        
        if (v < 0) {
            if (rewindInterval) return; // Already rewinding
            if (!audio.paused) startContinuousRewind(v);
        } else {
            const wasRewindingActive = rewindInterval !== null;
            stopContinuousRewind();
            audio.playbackRate = v;
            
            if (wasRewindingActive && wasPlayingBeforeRewind) {
                audio.play().catch(console.error);
                if (playButton) playButton.textContent = 'Pause';
            }
        }
    });

    progressBar?.addEventListener('mousedown', () => isSeeking = true);
    progressBar?.addEventListener('mouseup', () => isSeeking = false);
    progressBar?.addEventListener('input', () => {
        if (!audio) return;
        audio.currentTime = (progressBar.value / 100) * audio.duration;
        updateProgress(); // Call updateProgress directly to update time display
    });

    [chunkSizeInput, rewindStepInput, rewindFreq, rewindOverlap, rewindPlaybackSpeed].forEach(slider => {
        slider?.addEventListener('input', updateParameterLabels);
    });

    // Initialize
    setSpeedLabel(parseFloat(speedSlider?.value || '1'));
    updateParameterLabels();
    loadDefaultTrack();

    // Cleanup
    window.addEventListener('beforeunload', () => {
        if (currentAudio) URL.revokeObjectURL(currentAudio);
        if (audioContext) audioContext.close();
        if (rewindInterval) clearTimeout(rewindInterval);
    });
});