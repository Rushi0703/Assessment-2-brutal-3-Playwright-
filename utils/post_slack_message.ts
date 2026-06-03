import { WebClient } from "@slack/web-api";
import os from "os";
import dotenv from "dotenv";
dotenv.config();

//===============================================================================================
// Required variables
const slackAccessToken: string = process.env.SLACK_ACCESS_TOKEN || '';
const slackChannelName: string = process.env.SLACK_CHANNEL_NAME || '';
const web = new WebClient(slackAccessToken);
//===============================================================================================


/**`
 * Posts a Slack message about the test case execution.
 *
 * @param {string} message - Optional additional message.
 * @param {string} testcaseId - The ID of the test case.
 * @param {any} executionData - Metadata for test execution.
 * @param {"start" | "end"} phase - Start or end of test execution.
 */
export const sendSlackMessage = async (testcaseId: string, startTime: any, endTime: any, status: any, errorMessage?: string): Promise<void> => {
    try {
        let slackMessage = "";
        const executedBy = os.userInfo().username;
        const executionTime = startTime ? new Date(startTime).toLocaleString() : "N/A";
        const duration = endTime ? `${Math.floor((endTime - startTime) / 60000)}m ${Math.floor(((endTime - startTime) % 60000) / 1000)}s` : "N/A";
        const channelName = `#${slackChannelName}`;

        slackMessage =
            `🆔 *Test Case ID*: ${testcaseId}\n` +
            `🕒 *Execution Time*: ${executionTime}\n` +
            `⏱️ *Duration*: ${duration}\n` +
            `${status === "failed" ? "❌" : "✅"} *Status*: ${status}\n` +
            `👤 *Executed By*: ${executedBy}\n` +
            (errorMessage ? `⚠️ *Error Message*: ${errorMessage}\n` : "") +
            `🔧 Using *Playwright TypeScript (PLATS) Framework*`;

        try {
            await web.chat.postMessage({
                channel: channelName,
                text: `📘 ${"Test Case Execution Summary"} - Test Case ID: ${testcaseId}`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `📘 *${"Test Case Execution Summary"}*`
                        }
                    },
                    {
                        type: "divider"
                    },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: slackMessage
                        }
                    }
                ]
            });

        } catch (error: any) {
            console.error(`Error posting message to Slack: ${error.message}`);
            throw new Error(`Failed to post message to Slack channel ${channelName}: ${error.message}`);
        }

    } catch (error: any) {
        console.error(`Error in sendSlackMessage: ${error.message}`);
        throw error;
    }
};

