import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route for login notification
  app.post("/api/notify-login", (req, res) => {
    const { name, email, timestamp } = req.body;
    
    console.log(`[EMAIL NOTIFICATION] To: patricioaug@gmail.com`);
    console.log(`[EMAIL NOTIFICATION] Subject: Novo Login no Missão Som do S`);
    console.log(`[EMAIL NOTIFICATION] Body: O usuário ${name} (${email}) fez login em ${timestamp}.`);
    
    // In a real app, you'd use nodemailer or a service like SendGrid here.
    res.json({ success: true, message: "Notificação enviada." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
