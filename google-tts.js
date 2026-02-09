/* =============================================
   LÔ TÔ - GOOGLE TTS MODULE
   Text-to-speech using Google Translate's API (Unofficial)
   ============================================= */

const GoogleTTS = {
    // Configuration
    LANG: 'vi',

    // Google Translate TTS Endpoint
    // client=tw-ob is the standard for unofficial access
    ENDPOINT: 'https://translate.google.com/translate_tts',

    // Speak text using Google TTS
    // Returns a Promise that resolves when audio finishes playing
    async speak(text, rate = 1) {
        return new Promise((resolve, reject) => {
            const audio = new Audio();

            // Construct URL
            // client=gtx seems to be more stable than tw-ob
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
            // audio.crossOrigin = 'anonymous'; // REMOVED: This causes CORS errors. simple playback doesn't need it.

            audio.onended = () => {
                resolve();
            };

            audio.onerror = (e) => {
                console.warn('Google TTS Error', e);
                // If it fails (e.g. 429 Too Many Requests), reject so we fallback
                reject(e);
            };

            // Attempt to play
            const playPromise = audio.play().catch(e => {
                console.warn('Google TTS Play Error', e);
                reject(e);
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (!audio.paused) {
                    audio.pause();
                    resolve(); // Resolve anyway so game continues
                } else if (audio.currentTime === 0) {
                    // Hasn't started yet
                    resolve();
                }
            }, 10000);
        });
    }
};

window.GoogleTTS = GoogleTTS;
