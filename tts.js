/* =============================================
   LÔ TÔ - TEXT-TO-SPEECH MODULE
   Vietnamese number pronunciation with traditional rhymes
   ============================================= */

const TTS = {
    // Vietnamese number words
    numbers: {
        0: 'không',
        1: 'một',
        2: 'hai',
        3: 'ba',
        4: 'bốn',
        5: 'năm',
        6: 'sáu',
        7: 'bảy',
        8: 'tám',
        9: 'chín',
        10: 'mười'
    },

    // Traditional Vietnamese Lô Tô rhymes (authentic caller phrases)
    rhymes: {
        1: 'Nhất phát đăng khoa',
        2: 'Nhị gia hòa thuận',
        3: 'Tam tài vạn lợi',
        4: 'Tứ hải giao tình',
        5: 'Ngũ phúc lâm môn',
        6: 'Lục súc hưng vượng',
        7: 'Thất tinh tụ hội',
        8: 'Bát tiên quá hải',
        9: 'Cửu trùng xuân sắc',
        10: 'Thập toàn thập mỹ',
        11: 'Mười một, một ông cháu',
        12: 'Mười hai, em hai rằng em yêu anh',
        13: 'Mười ba, cơm vua chả chạy',
        14: 'Mười bốn, đôi ta thương nhau',
        15: 'Mười lăm, trăng rằm sáng tỏ',
        16: 'Mười sáu, tuổi mười sáu trăng tròn',
        17: 'Mười bảy, bẻ gãy sừng trâu',
        18: 'Mười tám, đôi mươi thanh xuân',
        19: 'Mười chín, suýt soát hai mươi',
        20: 'Hai mươi, đôi ngang',
        21: 'Hai mốt, bán rẻ, bán đắt cũng lời',
        22: 'Hai hai, con ngỗng te te',
        23: 'Hai ba, yêu nhau lắm cắn nhau đau',
        24: 'Hai bốn, cô gái hai cân',
        25: 'Hai lăm, chát chát chít chít',
        26: 'Hai sáu, nàng về dinh',
        27: 'Hai bảy, bảy đi ba ngày',
        28: 'Hai tám, tiền bầu nước vối',
        29: 'Hai chín, ông thần mập mạp',
        30: 'Ba mươi, tối như đêm ba mươi',
        31: 'Ba mốt, đào, quýt, cam, chanh',
        32: 'Ba hai, đi đâu về đâu',
        33: 'Ba ba, con rùa',
        34: 'Ba tư, thầy tư ngồi đếm',
        35: 'Ba lăm, lên mây năm sắc',
        36: 'Ba sáu, con sáo sang sông',
        37: 'Ba bảy, mẹ dạy con thơ',
        38: 'Ba tám, cha già cầu tự',
        39: 'Ba chín, rượu nồng lai láng',
        40: 'Bốn mươi, ngang tàng lém lỉnh',
        41: 'Bốn mốt, một niềm vui',
        42: 'Bốn hai, trên đôi dưới đôi',
        43: 'Bốn ba, trống bỏi kèn ta',
        44: 'Bốn tư, bốn con chó ngồi trong tủ',
        45: 'Bốn lăm, cầm can mà về',
        46: 'Bốn sáu, đẹp trai như sáu',
        47: 'Bốn bảy, gáy to lên bảy',
        48: 'Bốn tám, đệm và nệm',
        49: 'Bốn chín, chin lén chớ coi',
        50: 'Năm mươi, nửa trăm nửa chục',
        51: 'Năm mốt, ngũ thập nhất',
        52: 'Năm hai, phải hai mà về',
        53: 'Năm ba, chợ Cầu Ông Lãnh',
        54: 'Năm tư, ở nhà bà từ',
        55: 'Năm lăm, lịch sự đàng hoàng',
        56: 'Năm sáu, sáu câu ca dao',
        57: 'Năm bảy, chim bảy màu',
        58: 'Năm tám, giữ tám cổ',
        59: 'Năm chín, mắc cỡ chín',
        60: 'Sáu mươi, hưởng dương trọn đời',
        61: 'Sáu mốt, vợ nọ con kia',
        62: 'Sáu hai, chị dâu ôm hai',
        63: 'Sáu ba, bà già xúc đất',
        64: 'Sáu tư, tư duy sáu',
        65: 'Sáu lăm, năm lăm thêm mười',
        66: 'Sáu sáu, lục lục thêm lời',
        67: 'Sáu bảy, bảy bà trộm khoai',
        68: 'Sáu tám, phát tài phát lộc',
        69: 'Sáu chín, ngang bằng lộn ngược',
        70: 'Bảy mươi, lụm cụm già',
        71: 'Bảy mốt, khấp khểnh đầu gối',
        72: 'Bảy hai, như con cá sặc rô hai',
        73: 'Bảy ba, cò đậu cành tre',
        74: 'Bảy tư, đẹp trai râu hùm',
        75: 'Bảy lăm, lăm le muốn dzô',
        76: 'Bảy sáu, sáu trưởng tám bé',
        77: 'Bảy bảy, hai con quạ',
        78: 'Bảy tám, bảy tám quên già',
        79: 'Bảy chín, chín mươi trừ một',
        80: 'Tám mươi, về hội',
        81: 'Tám mốt, nhất mộc nan trì',
        82: 'Tám hai, thọ trường hơn tuổi',
        83: 'Tám ba, ông già gân',
        84: 'Tám tư, bát tự sáng ngời',
        85: 'Tám lăm, lăm lăm hai lần',
        86: 'Tám sáu, phát tài phát lộc',
        87: 'Tám bảy, cúi đầu ngó xuống',
        88: 'Tám tám, phát lộc phát tài',
        89: 'Tám chín, đâu đâu cũng có',
        90: 'Chín mươi, trăm trừ mười, hết số rồi!'
    },

    // Configuration
    config: {
        rate: 0.9,
        pitch: 1,
        volume: 1,
        voice: null
    },

    // Speech synthesis instance
    synth: window.speechSynthesis,

    // Initialize TTS
    init() {
        // Load Vietnamese voice when available
        this.loadVoices();

        // Some browsers load voices asynchronously
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => this.loadVoices();
        }

        console.log('TTS initialized with authentic Lô Tô rhymes');
    },

    // Load available voices and find Vietnamese
    loadVoices() {
        const voices = this.synth.getVoices();

        // Try to find Vietnamese voice
        this.config.voice = voices.find(voice =>
            voice.lang.startsWith('vi') ||
            voice.name.toLowerCase().includes('vietnam')
        );

        // Fallback to default if no Vietnamese voice
        if (!this.config.voice && voices.length > 0) {
            // Try to find a female voice for better clarity
            this.config.voice = voices.find(v => v.name.toLowerCase().includes('female')) || voices[0];
        }

        console.log('TTS Voice:', this.config.voice?.name || 'default');
    },

    // Convert number to Vietnamese words
    numberToWords(num) {
        if (num < 0 || num > 99) return '';

        if (num <= 10) {
            return this.numbers[num];
        }

        if (num < 20) {
            const unit = num % 10;
            if (unit === 0) return 'mười';
            if (unit === 1) return 'mười một';
            if (unit === 5) return 'mười lăm';
            return `mười ${this.numbers[unit]}`;
        }

        const tens = Math.floor(num / 10);
        const unit = num % 10;

        let result = `${this.numbers[tens]} mươi`;

        if (unit === 0) return result;
        if (unit === 1) return `${result} mốt`;
        if (unit === 4) return `${result} tư`;
        if (unit === 5) return `${result} lăm`;

        return `${result} ${this.numbers[unit]}`;
    },

    // Get the rhyme for a number
    getNumberRhyme(num) {
        return this.rhymes[num] || `Số ${this.numberToWords(num)}`;
    },

    // Speak a number with its rhyme
    speakNumber(num) {
        // Cancel any ongoing speech
        this.synth.cancel();

        // Small delay to ensure cancel takes effect
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const rhyme = this.getNumberRhyme(num);
                const text = `Số ${this.numberToWords(num)}... ${rhyme}`;
                const utterance = new SpeechSynthesisUtterance(text);

                // Apply configuration
                utterance.rate = this.config.rate;
                utterance.pitch = this.config.pitch;
                utterance.volume = this.config.volume;

                if (this.config.voice) {
                    utterance.voice = this.config.voice;
                }

                // Try to use Vietnamese language
                utterance.lang = 'vi-VN';

                // Handle completion
                utterance.onend = () => {
                    resolve();
                };

                utterance.onerror = (event) => {
                    console.warn('TTS error:', event.error);
                    resolve(); // Don't reject, just continue
                };

                // Start speaking
                this.synth.speak(utterance);

                // Fallback timeout in case onend never fires
                setTimeout(() => {
                    resolve();
                }, 5000);
            }, 100);
        });
    },

    // Speak custom text
    speak(text) {
        this.synth.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.config.rate;
        utterance.pitch = this.config.pitch;
        utterance.volume = this.config.volume;
        utterance.lang = 'vi-VN';

        if (this.config.voice) {
            utterance.voice = this.config.voice;
        }

        return new Promise((resolve, reject) => {
            utterance.onend = resolve;
            utterance.onerror = reject;
            this.synth.speak(utterance);
        });
    },

    // Announce a called number with rhyme
    async announceNumber(num) {
        await this.speakNumber(num);
    },

    // Announce winner
    async announceWinner(name = 'Có người') {
        await this.speak(`${name} đã trúng lô tô! Xin chúc mừng!`);
    },

    // Set speech rate
    setRate(rate) {
        this.config.rate = Math.max(0.5, Math.min(1.5, rate));
    },

    // Set volume
    setVolume(volume) {
        this.config.volume = Math.max(0, Math.min(1, volume));
    },

    // Stop speaking
    stop() {
        this.synth.cancel();
    }
};

// Initialize TTS on load
TTS.init();
