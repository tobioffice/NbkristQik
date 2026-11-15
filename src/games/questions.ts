/**
 * The starter question bank.
 *
 * Branch-neutral on purpose: the league is played across every department, so
 * the first set stays on school-level science, maths, computing and general
 * knowledge. Each row has a stable slug, so seeding is idempotent and a
 * question can be edited in the database without a reseed overwriting it.
 *
 * The correct option's position is derived from the slug rather than written
 * by hand. That keeps the bank varied without a second thing to get wrong;
 * the database stores the final order and the index.
 */

export interface SeedQuestion {
  slug: string;
  prompt: string;
  options: string[];
  correct: number;
  topic: string;
}

/** Deterministic 32-bit hash, used only to vary the correct option's slot. */
const slotOf = (slug: string): number => {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return hash % 4;
};

const q = (
  slug: string,
  prompt: string,
  correct: string,
  wrong: [string, string, string],
  topic: string,
): SeedQuestion => {
  const options = [...wrong];
  const correctIndex = slotOf(slug);
  options.splice(correctIndex, 0, correct);
  return { slug, prompt, options, correct: correctIndex, topic };
};

export const STARTER_QUESTIONS: SeedQuestion[] = [
  q(
    "cpu-full",
    "What does CPU stand for?",
    "Central Processing Unit",
    [
      "Central Program Unit",
      "Computer Personal Unit",
      "Central Process Utility",
    ],
    "computing",
  ),
  q(
    "fifo",
    "Which data structure works first in, first out?",
    "Queue",
    ["Stack", "Tree", "Graph"],
    "computing",
  ),
  q(
    "kilobyte",
    "How many bytes are in one kilobyte, as usually taught in computing?",
    "1024",
    ["1000", "512", "2048"],
    "computing",
  ),
  q(
    "browser-language",
    "Which language runs inside a web browser?",
    "JavaScript",
    ["C++", "Java", "Python"],
    "computing",
  ),
  q(
    "html-full",
    "What does HTML stand for?",
    "HyperText Markup Language",
    [
      "HighText Machine Language",
      "HyperTool Markup Language",
      "Home Tool Markup Language",
    ],
    "computing",
  ),
  q(
    "not-an-os",
    "Which one is not an operating system?",
    "Oracle",
    ["Linux", "Windows", "macOS"],
    "computing",
  ),
  q(
    "sql-full",
    "What does SQL stand for?",
    "Structured Query Language",
    [
      "Simple Query Language",
      "Standard Question Language",
      "System Query Logic",
    ],
    "computing",
  ),
  q(
    "universal-gate",
    "Which logic gate is called a universal gate?",
    "NAND",
    ["AND", "OR", "XOR"],
    "computing",
  ),
  q(
    "binary-1010",
    "What is binary 1010 in decimal?",
    "10",
    ["8", "12", "14"],
    "computing",
  ),
  q(
    "father-of-computers",
    "Who is known as the father of computers?",
    "Charles Babbage",
    ["Alan Turing", "John von Neumann", "Bill Gates"],
    "computing",
  ),
  q(
    "binary-search",
    "What is the time complexity of binary search on a sorted array?",
    "O(log n)",
    ["O(n)", "O(n log n)", "O(1)"],
    "computing",
  ),
  q(
    "ram-full",
    "What does RAM stand for?",
    "Random Access Memory",
    ["Read Access Memory", "Rapid Access Memory", "Runtime Access Memory"],
    "computing",
  ),
  q(
    "http-full",
    "What does HTTP stand for?",
    "HyperText Transfer Protocol",
    [
      "HyperText Transmission Process",
      "High Transfer Text Protocol",
      "Hyperlink Text Transfer Protocol",
    ],
    "computing",
  ),
  q(
    "java-company",
    "Which company created Java?",
    "Sun Microsystems",
    ["Microsoft", "IBM", "Apple"],
    "computing",
  ),
  q(
    "stack-lifo",
    "Which data structure works last in, first out?",
    "Stack",
    ["Queue", "Heap", "Array"],
    "computing",
  ),
  q(
    "gpu-full",
    "What does GPU stand for?",
    "Graphics Processing Unit",
    [
      "General Processing Unit",
      "Graphical Program Unit",
      "Grid Processing Unit",
    ],
    "computing",
  ),
  q(
    "volatile-memory",
    "Which memory loses its contents when the power is cut?",
    "RAM",
    ["ROM", "SSD", "Hard disk"],
    "computing",
  ),
  q(
    "url-full",
    "What does URL stand for?",
    "Uniform Resource Locator",
    [
      "Universal Reference Link",
      "Unified Resource Link",
      "Uniform Retrieval Language",
    ],
    "computing",
  ),
  q(
    "smtp",
    "Which protocol is used to send email?",
    "SMTP",
    ["HTTP", "FTP", "SSH"],
    "computing",
  ),
  q(
    "android-company",
    "Which company develops Android?",
    "Google",
    ["Apple", "Microsoft", "Nokia"],
    "computing",
  ),
  q(
    "pi-two-places",
    "What is pi to two decimal places?",
    "3.14",
    ["3.41", "3.12", "3.16"],
    "maths",
  ),
  q(
    "fifteen-percent",
    "What is 15% of 200?",
    "30",
    ["15", "20", "45"],
    "maths",
  ),
  q(
    "derivative-x-squared",
    "What is the derivative of x squared?",
    "2x",
    ["x", "x squared", "2"],
    "maths",
  ),
  q(
    "triangle-angles",
    "What is the sum of the angles in a triangle?",
    "180 degrees",
    ["90 degrees", "270 degrees", "360 degrees"],
    "maths",
  ),
  q(
    "square-root-144",
    "What is the square root of 144?",
    "12",
    ["14", "16", "10"],
    "maths",
  ),
  q(
    "seven-times-eight",
    "What is 7 times 8?",
    "56",
    ["54", "48", "64"],
    "maths",
  ),
  q(
    "prime-29",
    "Which of these is a prime number?",
    "29",
    ["21", "27", "33"],
    "maths",
  ),
  q(
    "log-1000",
    "What is log base 10 of 1000?",
    "3",
    ["2", "10", "100"],
    "maths",
  ),
  q(
    "circle-area",
    "What is the area of a circle?",
    "pi times r squared",
    ["2 pi r", "pi times d", "r squared"],
    "maths",
  ),
  q(
    "two-to-ten",
    "What is 2 to the power 10?",
    "1024",
    ["512", "1000", "2048"],
    "maths",
  ),
  q(
    "hcf-12-18",
    "What is the highest common factor of 12 and 18?",
    "6",
    ["3", "9", "12"],
    "maths",
  ),
  q(
    "lcm-4-6",
    "What is the lowest common multiple of 4 and 6?",
    "12",
    ["24", "10", "6"],
    "maths",
  ),
  q(
    "zero-factorial",
    "What is 0 factorial?",
    "1",
    ["0", "10", "undefined"],
    "maths",
  ),
  q(
    "right-angle",
    "How many degrees are in a right angle?",
    "90",
    ["45", "180", "360"],
    "maths",
  ),
  q(
    "next-prime",
    "What is the next prime number after 7?",
    "11",
    ["9", "13", "10"],
    "maths",
  ),
  q(
    "force-unit",
    "What is the SI unit of force?",
    "Newton",
    ["Joule", "Watt", "Pascal"],
    "physics",
  ),
  q(
    "light-speed",
    "What is the approximate speed of light in a vacuum?",
    "3 x 10^8 m/s",
    ["3 x 10^6 m/s", "3 x 10^10 m/s", "3 x 10^5 m/s"],
    "physics",
  ),
  q(
    "current-unit",
    "What is the SI unit of electric current?",
    "Ampere",
    ["Volt", "Ohm", "Coulomb"],
    "physics",
  ),
  q(
    "voltmeter",
    "What does a voltmeter measure?",
    "Voltage",
    ["Current", "Resistance", "Power"],
    "physics",
  ),
  q(
    "law-of-inertia",
    "Which law is also called the law of inertia?",
    "First law of motion",
    ["Second law of motion", "Third law of motion", "Law of gravitation"],
    "physics",
  ),
  q(
    "gravity",
    "What is the acceleration due to gravity on Earth, roughly?",
    "9.8 m/s squared",
    ["8.9 m/s squared", "10.8 m/s squared", "9.8 m/s"],
    "physics",
  ),
  q(
    "power-unit",
    "What is the SI unit of power?",
    "Watt",
    ["Joule", "Newton", "Ampere"],
    "physics",
  ),
  q(
    "red-wavelength",
    "Which colour of visible light has the longest wavelength?",
    "Red",
    ["Blue", "Green", "Violet"],
    "physics",
  ),
  q(
    "boiling-point",
    "What is the boiling point of water at sea level?",
    "100 degrees Celsius",
    ["90 degrees Celsius", "110 degrees Celsius", "0 degrees Celsius"],
    "physics",
  ),
  q(
    "ohms-law",
    "Ohm's law says voltage equals what?",
    "Current times resistance",
    [
      "Current divided by resistance",
      "Resistance divided by current",
      "Power times current",
    ],
    "physics",
  ),
  q(
    "electron-charge",
    "Which particle carries a negative charge?",
    "Electron",
    ["Proton", "Neutron", "Photon"],
    "physics",
  ),
  q(
    "spring-energy",
    "What energy is stored in a stretched spring?",
    "Potential energy",
    ["Kinetic energy", "Thermal energy", "Chemical energy"],
    "physics",
  ),
  q(
    "sound-vacuum",
    "Sound cannot travel through what?",
    "Vacuum",
    ["Air", "Water", "Steel"],
    "physics",
  ),
  q(
    "capital-of-india",
    "What is the capital of India?",
    "New Delhi",
    ["Mumbai", "Kolkata", "Chennai"],
    "general",
  ),
  q(
    "national-bird",
    "What is the national bird of India?",
    "Peacock",
    ["Parrot", "Eagle", "Swan"],
    "general",
  ),
  q(
    "indian-states",
    "How many states does India have?",
    "28",
    ["29", "27", "30"],
    "general",
  ),
  q(
    "anthem-author",
    "Who wrote India's national anthem?",
    "Rabindranath Tagore",
    ["Bankim Chandra Chatterjee", "Sarojini Naidu", "Mahatma Gandhi"],
    "general",
  ),
  q(
    "largest-planet",
    "Which is the largest planet in the solar system?",
    "Jupiter",
    ["Saturn", "Earth", "Neptune"],
    "general",
  ),
  q(
    "continents",
    "How many continents are there?",
    "7",
    ["5", "6", "8"],
    "general",
  ),
  q(
    "japan-currency",
    "What is the currency of Japan?",
    "Yen",
    ["Won", "Yuan", "Ringgit"],
    "general",
  ),
  q(
    "varanasi-river",
    "Which river flows through Varanasi?",
    "Ganga",
    ["Yamuna", "Godavari", "Narmada"],
    "general",
  ),
  q(
    "first-prime-minister",
    "Who was India's first Prime Minister?",
    "Jawaharlal Nehru",
    ["Sardar Patel", "Rajendra Prasad", "Lal Bahadur Shastri"],
    "general",
  ),
  q(
    "gold-symbol",
    "What is the chemical symbol for gold?",
    "Au",
    ["Ag", "Gd", "Go"],
    "general",
  ),
  q(
    "red-planet",
    "Which planet is called the Red Planet?",
    "Mars",
    ["Venus", "Jupiter", "Mercury"],
    "general",
  ),
  q(
    "australia-capital",
    "What is the capital of Australia?",
    "Canberra",
    ["Sydney", "Melbourne", "Perth"],
    "general",
  ),
  q(
    "plant-gas",
    "Which gas do plants absorb from the air?",
    "Carbon dioxide",
    ["Oxygen", "Nitrogen", "Hydrogen"],
    "general",
  ),
  q(
    "day-minutes",
    "How many minutes are in a day?",
    "1440",
    ["1200", "1600", "2400"],
    "general",
  ),
  q(
    "www-full",
    "What does WWW stand for?",
    "World Wide Web",
    ["World Web Wide", "Wide World Web", "Web World Wide"],
    "general",
  ),
  q(
    "smallest-prime",
    "What is the smallest prime number?",
    "2",
    ["1", "3", "0"],
    "general",
  ),
  q(
    "hardest-substance",
    "What is the hardest natural substance?",
    "Diamond",
    ["Gold", "Iron", "Quartz"],
    "general",
  ),
];
