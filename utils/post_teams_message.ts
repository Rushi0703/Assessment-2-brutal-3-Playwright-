import axios from "axios";
import os from "os";
import dotenv from "dotenv";
dotenv.config();


export const sendTeamsMessage = async (testcaseId: string, startTime: any, endTime: any, testStatus: any, errorMessage?: string): Promise<void> => {
    let teamsMessage = "";
    const executedBy = os.userInfo().username;
    const executionTime = startTime ? new Date(startTime).toLocaleString() : "N/A";
    const duration = endTime ? `${Math.floor((endTime - startTime) / 60000)}m ${Math.floor(((endTime - startTime) % 60000) / 1000)}s` : "N/A";
    const status = testStatus ?? "passed";
    const teamsWebhookLink = process.env.TEAMS_WEBHOOK_URL;

    try {
        teamsMessage =
            `• 🆔 **Test Case ID**: ${testcaseId}\n\n` +
            `• 🕒 **Execution Time**: ${executionTime}\n\n` +
            `• ⏱️ **Duration**: ${duration}\n\n` +
            `• ${status === "failed" ? "❌" : "✅"} **Status**: ${status}\n\n` +
            `• 👤 **Executed By**: ${executedBy}\n\n` +
            (errorMessage ? `• ⚠️ **Error Message**: ${errorMessage}\n\n` : "") +
            `🔧 Using *Playwright TypeScript (PLATS) Framework*`;

        try {
            if (!teamsWebhookLink) {
                throw new Error("TEAMS_WEBHOOK_URL is not set in the environment variables");
            }
            await axios.post(teamsWebhookLink, {
                "@type": "MessageCard",
                "@context": "https://schema.org/extensions",
                "themeColor": (testStatus === "failed" ? "FF0000" : "0076D7"),
                "summary": `Test notification for ${testcaseId}`,
                "sections": [
                    {
                        "activityTitle": `📘 ${"Test Case Execution Summary"}`,
                        "text": teamsMessage
                    }
                ]
            });

        } catch (error: any) {
            console.error(`Error posting message to Teams: ${error.message}`);
            throw error;
        }
    }
    catch (error: any) {
        console.error(`Error in sendTeamsMessage: ${error.message}`);
        throw error;
    }
};

