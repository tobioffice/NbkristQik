//exporting variables
export const MESSAGES = {
    branches: {
        5: 'CSE',
        23: 'AIDS',
        7: 'MECH',
        4: 'ECE',
        2: 'EEE',
        11: 'CIV',
        22: 'IT',
        32: 'CSE_DS',
        33: 'CSE_AIML',
    },

    GENERATING: 'Generating response...',

    JOIN_GROUP: '🚫 Join NbkistQik to access this feature',

    CLG_SERVER_DOWN: '⚠️ collage server is not responding. Please try again later.',

    INVALID_ROLL: '⚠️ Invalid Roll Number ❗',

    CMDS_MESSAGE:
        "<b>Welcome to the Bot!</b> Here's how you can interact:\n\n" +
        "🧠 <code>/ai [query]</code> - Ask anything. <em>E.g., /ai What's the capital of France?</em>\n\n" +
        "🎨 <code>/img [prompt]</code> - Generate an image. <em>E.g., /img Sunset over the ocean</em>\n\n" +
        "👉 <b>Ready to use me? Let's go!</b> 🚀",

    START_CMD:
        "Hello! 👋 I'm Tobi, your AI-powered assistant.\n\n" +
        "<b>What I can do for you:</b>\n\n" +
        "<code>/ai</code> - Ask me anything or interact with AI-powered responses.\n" +
        "<code>/cmds</code> - to see how to use them.\n" +
        "<code>/help</code> - To know how to check Attendance and Midmarks\n\n" +
        "👉 <b>Ready to use me? Let's go!</b> 🚀",
};


//exporting request urls
const BASE_URL = 'http://103.203.175.90:94';

export const urls = {
    base: BASE_URL,
    login: BASE_URL + '/attendance/attendanceLogin.php',
    attendance: BASE_URL + '/attendance/attendanceTillTodayReport.php',
    midmarks: BASE_URL + '/mid_marks/marksConsolidateReport.php',
};

export const headers = (command: string) => {
    const hdrs = {
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
        Origin: urls.base,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
        Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        Referer: command === 'mid' ? urls.midmarks : urls.attendance,
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: ``,
        Connection: 'close',
    };
    return hdrs;
};

export const ROLL_REGEX = /^\d{2}[a-zA-Z]{2}[a-zA-Z0-9]{6}$/;