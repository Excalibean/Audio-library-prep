document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');

    let currentAudio = null;

    uploadForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const files = fileInput.files;
        if (files.length) addFiles(files);
    });

    //speed slider behavior
    speedSlider.addEventListener('input', () => {
        speedLabel.textContent = '${speedSlider.value}x';
        const v = parseFloat(speedSlider.value);
        audioItems.forEach(item => item.audio.playbackRate = v);
    });

    //Audio play button behavior
    const playButton = document.getElementById('button');
    playButton.textContent = 'Play';

    playButton.addEventListener('click', () => {
        if(currentAudio && !currentAudio.paused){
            currentAudio.pause();
            playButton.textContent = 'Play';
        }
        else if (audio.paused) {
            audio.play();
            playButton.textContent = 'Pause';
            currentAudio = audio;
            currentAudio._playBtn = playButton;
        } else {
            audio.pause();
            playButton.textContent = 'Play';
        }
    })

    audio.addEventListener('ended', () => {
        playButton.textContent = 'Play';
    });
})