import { GoogleGenAI, Type } from '@google/genai';
import { config } from 'dotenv';
import { History } from '../types';
import { addHistory } from '../db/history.model';
config(); // Load environment variables from .env file

interface Conversation {
    role: 'user' | 'model' | 'system';
    content: string;
}

interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: Type;
        properties: Record<string, {
            type: Type;
            description: string;
        }>;
        required: string[];
    };
}

export class AIAgent {
    private ai: GoogleGenAI;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        this.ai = new GoogleGenAI({ apiKey });
    }

    // Example function declarations
    private functionDeclarations: FunctionDeclaration[] = [];

    public addFunctionDeclaration(func: FunctionDeclaration) {
        this.functionDeclarations.push(func);
    }

    private async executeFunction(name: string, args: any): Promise<string> {
        const func = this.functionDeclarations.find(f => f.name === name);
        if (!func) {
            return `Function ${name} not found`;
        }

        const fn = (this as any)[func.name];
        return fn ? await fn(args) : `Function ${name} is not executable`;
    }

    async chat(prompt: string, chat_id: number, history?: History[]): Promise<string> {
        try {

            const conversationHistory: Conversation[] = [
                { role: 'system', content: "I'm your helpful AI friend! I'll try to keep our chat fun and interactive while helping you with whatever you need. Feel free to ask me anything!" }
            ];


            if (history) {
                conversationHistory.push(...history.map(h => ({ role: h.role, content: h.content })));
            }

            conversationHistory.push({ role: 'user', content: prompt });

            const response = await this.ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{
                    parts: conversationHistory.map(msg => ({
                        text: msg.content,
                        data: { role: msg.role }
                    }))
                }],
                config: {
                    tools: [{ functionDeclarations: this.functionDeclarations }]
                }
            });

            if (response.text) {
                await addHistory({
                    role: 'model',
                    content: response.text ?? 'No response text available'
                }, chat_id);
            }

            else if (response.functionCalls) {
                await addHistory({
                    role: 'model',
                    content: `Function call detected: ${JSON.stringify(response.functionCalls)}`
                }, chat_id);
            }

            if (response.functionCalls?.length) {
                const call = response.functionCalls[0];
                if (call.args && call.name) {
                    const result = await this.executeFunction(call.name as string, call.args);
                    conversationHistory.push({
                        role: 'model',
                        content: `Function ${call.name} result: ${result}`
                    });
                    // Generate natural language response about the function result
                    const finalResponse = await this.ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: [{
                            parts: conversationHistory.map(msg => ({
                                text: msg.content,
                                data: { role: msg.role }
                            }))
                        }],
                        config: {
                            tools: [{ functionDeclarations: this.functionDeclarations }]
                        }
                    });

                    await addHistory({
                        role: 'model',
                        content: finalResponse.text ?? 'No response text available'
                    }, chat_id);

                    return finalResponse.text ?? `The function returned: ${result}`;
                }
            }

            const responseText = response.text ?? 'No response text available';
            // For non-function responses, return the model's text directly
            return responseText;
        } catch (error) {
            console.error('Chat error:', error);
            throw error;
        }
    }
}