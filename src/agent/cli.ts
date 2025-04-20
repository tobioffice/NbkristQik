import { AttendanceModule } from './modules/attendance.module';
import readline from 'readline';

const agent = new AttendanceModule();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function chat() {
    rl.question('You: ', async (input) => {
        if (input.toLowerCase() === 'exit') {
            rl.close();
            return;
        }

        try {
            const response = await agent.chat(input);
            console.log('AI:', response);
        } catch (error) {
            if (error instanceof Error) {
                console.error('Error:', error.message);
            } else {
                console.error('An unknown error occurred');
            }
        }

        chat(); // Continue chatting
    });
}

console.log('Chat with AI. Type "exit" to quit.');
chat();