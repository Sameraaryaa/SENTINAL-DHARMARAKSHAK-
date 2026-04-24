import { Router } from "express";

export const whatsappRouter = Router();

whatsappRouter.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

whatsappRouter.post("/webhook", async (req, res) => {
    // Process WhatsApp webhook events here
    res.sendStatus(200);
});
