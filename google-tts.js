/* =============================================
   LÔ TÔ - GOOGLE TTS MODULE
   Text-to-speech using Google Translate's API (Unofficial)
   ============================================= */

const GoogleTTS = {
    // Configuration
    LANG: 'vi',
    currentAudio: null, // Track current audio

    // Google Translate TTS Endpoint
    // client=tw-ob is the standard for unofficial access
    ENDPOINT: 'https://translate.google.com/translate_tts',

    // Speak text using Google TTS
    // Returns a Promise that resolves when audio finishes playing
    async speak(text, rate = 1) {
        return new Promise((resolve, reject) => {
            if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
            }

            const audio = new Audio();
            this.currentAudio = audio; // Store reference

            // Construct URL
            const params = new URLSearchParams({
                ie: 'UTF-8',
                q: text,
                tl: this.LANG,
                client: 'gtx',
                dt: 't' // Return translated text (required for some endpoints)
            });

            // Use allorigins proxy to bypass CORS and 404 blocks
            const googleUrl = `${this.ENDPOINT}?${params.toString()}`;
            audio.src = `https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`;

            // Set initial volume if TTS config exists (accessed via global TTS object if available, or default)
            audio.volume = window.TTS ? window.TTS.config.volume : 1.0;

            audio.onended = () => {
                if (this.currentAudio === audio) this.currentAudio = null;
                resolve();
            };

            audio.onerror = (e) => {
                console.warn('Google TTS Error', e);
                if (this.currentAudio === audio) this.currentAudio = null;
                reject(e);
            };

            // Attempt to play
            audio.play().catch(e => {
                console.warn('Google TTS Play Error', e);
                if (this.currentAudio === audio) this.currentAudio = null;
                reject(e);
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (audio && !audio.paused) {
                    audio.pause();
                    if (this.currentAudio === audio) this.currentAudio = null;
                    resolve(); // Resolve anyway so game continues
                } else if (audio && audio.currentTime === 0 && !audio.ended) {
                    // Hasn't started yet
                    resolve();
                }
            }, 10000);
        });
    },

    setVolume(volume) {
        if (this.currentAudio) {
            this.currentAudio.volume = Math.max(0, Math.min(1, volume));
        }
    },

    stop() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
    }
};

window.GoogleTTS = GoogleTTS;
