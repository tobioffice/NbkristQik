import { AIAgent } from "../ai.service";
import { Type } from '@google/genai';
import { ROLL_REGEX } from "../../constants";
import { Acadamic } from "../../services/utils/Acadamic";

export class AttendanceModule extends AIAgent {
    constructor() {
        super();
        this.addFunctionDeclaration({
            name: 'get_attendance',
            description: 'Retrieves attendance for a student based on their roll number',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    rollNo: {
                        type: Type.STRING,
                        description: 'The roll number of the student'
                    }
                },
                required: ['rollNo']
            }
        });
    }

    public async get_attendance(args?: any): Promise<string> {
        const rollNo: string = args.rollNo || "";

        if (!rollNo) {
            return "Please provide a roll number.";
        }

        if (!rollNo.match(ROLL_REGEX)) {
            return "Invalid roll number format.";
        }

        const aca = new Acadamic(rollNo);

        const attendance = await aca.getAttendanceJSON();
        console.log(attendance);
        return JSON.stringify(attendance) || "Attendance not found.";
    }
}
