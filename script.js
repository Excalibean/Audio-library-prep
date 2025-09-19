document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const playButton = document.getElementById('play-button');
    const currentFile = document.getElementById('current-file');

    let audio = null;
    let currentAudio = null; //this is a url object

    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
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
    });
});