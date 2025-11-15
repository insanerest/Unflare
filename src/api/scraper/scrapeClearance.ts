import closePageAndBrowser from "@/api/scraper/browser/closePageAndBrowser";
import isBlocked from "@/api/scraper/browser/isBlocked";
import sendPostRequest from "@/api/scraper/browser/sendPostRequest";
import takeScreenshot from "@/api/scraper/browser/takeScreenshot";
import handleValidationError from "@/api/scraper/utils/handleValidationError";
import ErrorResponse from "@/common/utils/ErrorResponse";
import { handleFailureResponse, handleSuccessResponse } from "@/common/utils/httpHandlers";
import { logger } from "@/server";
import type { Request, Response } from "express";
import type pino from "pino";
import { connect, type PageWithCursor } from "puppeteer-real-browser";
import type { Browser } from "rebrowser-puppeteer-core";
import { z } from "zod";

const ProxySchema = z.object({
    host: z.string(),
    port: z.number(),
    username: z.string(),
    password: z.string(),
});

const PostRequestDataSchema = z.record(z.unknown());

export const ScrapeClearanceRequestSchema = z.object({
    url: z.string(),
    timeout: z.number(),
    proxy: ProxySchema.optional(),
    method: z.enum(["GET", "POST"]).optional().default("GET"),
    data: PostRequestDataSchema.optional(),
});

export type ScrapeClearanceData = z.infer<typeof ScrapeClearanceRequestSchema>;

interface TypedRequest extends Request {
    body: z.infer<typeof ScrapeClearanceRequestSchema>;
}

export async function scrapeClearance(req: TypedRequest, res: Response) {
    let browserLogger = logger.child({ endpoint: "scrapeClearance" });
    let browser;
    let page;

    try {
        const data = ScrapeClearanceRequestSchema.parse(req.body);

        browserLogger.info("Starting browser");

        const connectOptions: any = {
            headless: true,
            args: [],
            customConfig: {},
            turnstile: true,
            connectOption: {},
            disableXvfb: false,
            ignoreAllFlags: false,
        };

        if (data.proxy) {
            connectOptions.proxy = { ...data.proxy };
        }

        const connection = await connect(connectOptions);

        browser = connection.browser;
        page = connection.page;

        page.setDefaultTimeout(data.timeout ?? 60_000);

        if (data.method === "GET") {
            await page.goto(data.url, { waitUntil: "networkidle2" });
        } else if (data.method === "POST") {
            await sendPostRequest(page, data);
        }

        browserLogger.info(`Navigated to ${data.url} using ${data.method} method`);

        if (await isBlocked(page)) {
            browserLogger.info(
                "You were blocked by Cloudflare, this is likely because your IP address is blacklisted or your proxy is unreliable",
            );
            return handleFailureResponse(
                ErrorResponse.create("error", "Blocked by Cloudflare"),
                res,
            );
        }

        const session = await getClearance(page, browser, data, browserLogger);

        browserLogger.info("Successfully obtained clearance");

        return handleSuccessResponse(session, res);
    } catch (error) {
        const errorData: Record<string, unknown> = {};

        if (error instanceof Error) {
            errorData.msg = error.message;
            if (error.stack) errorData.stack = error.stack;
        } else {
            errorData.msg = String(error);
        }
        browserLogger.error(errorData);

        if (error instanceof z.ZodError) {
            return handleValidationError(error, res);
        }

        if (page && !page.isClosed()) {
            await takeScreenshot("obtaining-clearance", page);
        }

        const errorMessage: string = error instanceof Error ? error.message : "Unknown error";
        return handleFailureResponse(ErrorResponse.create("error", errorMessage), res);
    } finally {
        await closePageAndBrowser(page, browser, browserLogger);
    }
}

/*async function getClearance(
    page: PageWithCursor,
    browser: Browser,
    data: ScrapeClearanceData,
    logger: pino.Logger,
) {
    logger.info("Waiting for Cloudflare challenge to complete");

    let isResolved = false;

    return new Promise(async (resolve, reject) => {
        await page.setRequestInterception(true);
        page.on("request", async (request) => {
            request.continue();
        });
        page.on("response", async (res) => {
            const cookies = await browser.cookies();
            console.log(cookies);
            if (!reloaded) {
                page.reload();
                reloaded = true;
                console.log("RELOADED");
            }
            try {
                if (
                    [200, 302].includes(res.status()) &&
                    [data.url, data.url + "/"].includes(res.url())
                ) {
                    await page
                        .waitForNavigation({ waitUntil: "load", timeout: 10000 })
                        .catch(() => {});
                    const cookies = await browser.cookies();
                    let headers = res.request().headers();
                    delete headers["content-type"];
                    delete headers["accept-encoding"];
                    delete headers["accept"];
                    delete headers["content-length"];
                    isResolved = true;
                    clearInterval(cl);
                    resolve({ cookies, headers });
                }
            } catch (e) {}
        });

        const cl = setTimeout(async () => {
            if (!isResolved) {
                reject("Timeout Error");
            }
        }, data.timeout || 60000);
    });
}*/

async function getClearance(
    page: PageWithCursor,
    browser: Browser,
    data: ScrapeClearanceData,
    logger: pino.Logger,
) {
    logger.info("Waiting for Cloudflare challenge to complete");

    try {
        // Navigate to the target URL
        const response = await page.goto(data.url, {
            waitUntil: "load",
            timeout: data.timeout || 60000,
        });

        // Optional: wait a bit for Cloudflare challenge to finish
         await new Promise((r) => setTimeout(r, 1500));

        // Get cookies from the current browser context
        const cookies = await page.cookies();

        // Get main request headers
        if(!response){
            throw Error()
        }
        const headers = { ...response.request().headers() };
        ["content-type", "accept-encoding", "accept", "content-length"].forEach(
            (h) => delete headers[h],
        );

        return { cookies, headers };
    } catch (err) {
        throw new Error("Timeout or navigation failed: ");
    }
}