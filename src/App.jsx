import { useState, useEffect, useRef, useCallback } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "./App.css";

// ─── Constants ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are 'Smart-RTI', a strictly bounded legal AI assistant for the Indian RTI Act 2005.

STRICT BOUNDARIES:
You ONLY answer RTI (Right to Information) related questions. If the user asks anything outside RTI scope, respond exactly:
"I am a specialized legal assistant for Smart-RTI. I can only assist with RTI-related queries."

CORE RULES:
1. Detect the language of the user's message and reply in the SAME language (Hindi, English, Tamil, Telugu, Bengali, etc.)
2. Guide RTI filing step-by-step using the official portal: https://rtionline.gov.in → Submit Request → Accept Guidelines → Fill Form → Payment
3. BPL STATUS CHECK: Always ask if the applicant is Below Poverty Line:
   - BPL = YES → RTI fee is ₹0 (Zero), but must attach BPL certificate (PDF, max 1MB)
   - BPL = NO → RTI fee is ₹10, payable via Internet Banking / Credit/Debit Card (Master/Visa/RuPay) / UPI
4. Only Indian citizens are eligible to file RTI applications
5. RTI text must be under 3000 characters; if more, upload as supporting document (PDF, max 1MB)
6. No fee is required for First Appeal under RTI Act
7. After submission, a unique Registration Number is issued (format: AAAAA/R/E/YY/NNNNN)
8. Response timeline: 30 days for public information; 48 hours for life/liberty matters
9. First Appeal: file with First Appellate Authority if unsatisfied within 30 days of receiving reply or 30+30 days of no reply
10. Second Appeal: file with Central Information Commission (CIC) if First Appeal unsatisfactory

PORTAL STEPS TO SHARE:
- Submit Request: https://rtionline.gov.in → Submit Request
- Submit First Appeal: https://rtionline.gov.in → Submit First Appeal  
- View Status: https://rtionline.gov.in → View Status
- View History: https://rtionline.gov.in → View History

Always be empathetic, clear, and empowering. Cite relevant sections of RTI Act 2005 when applicable.`;

const MODEL_NAME = "gemini-2.5-flash";

const WELCOME_MESSAGE = {
  id: "welcome",
  role: "ai",
  text: `**नमस्ते! Welcome to Smart-RTI** 🇮🇳

I am your dedicated **Right to Information (RTI) Legal Assistant**, here to help you exercise your democratic right to information.

**I can help you with:**
- 📋 Filing RTI applications on [rtionline.gov.in](https://rtionline.gov.in)
- 💰 Understanding fee structure (BPL / Non-BPL)
- 📤 Submitting First Appeals
- 🔍 Tracking your RTI status
- ⏱️ Timelines, deadlines & legal provisions
- 📝 Drafting effective RTI request text

**To get started**, tell me:
1. What information do you want to seek?
2. Which Ministry/Department does it concern?

*Only Indian Citizens can file RTI applications under the RTI Act, 2005.*`,
  timestamp: new Date().toISOString(),
};

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createSession(title = "New Grievance") {
  return {
    id: generateId(),
    title,
    createdAt: new Date().toISOString(),
    messages: [WELCOME_MESSAGE],
  };
}

// ─── Markdown renderer (lightweight) ─────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // Bullet lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>");
  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // Paragraphs
  html = html
    .split(/\n\n+/)
    .map((p) => {
      p = p.trim();
      if (!p) return "";
      if (/^<(h[1-3]|ul|ol|li)/.test(p)) return p;
      return `<p>${p.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");

  return html;
}

// ─── Chat Bubble ──────────────────────────────────────────────────────────────
function ChatBubble({ message }) {
  const isUser = message.role === "user";
  const isError = message.isError;

  return (
    <div
      className={`bubble-row ${isUser ? "bubble-row--user" : "bubble-row--ai"}`}
    >
      {!isUser && (
        <div className="bubble-avatar bubble-avatar--ai" aria-label="Smart-RTI">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
      )}
      <div
        className={`bubble ${isUser ? "bubble--user" : "bubble--ai"} ${isError ? "bubble--error" : ""}`}
      >
        {isUser ? (
          <span className="bubble-text">{message.text}</span>
        ) : (
          <div
            className="bubble-text bubble-text--rendered"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
          />
        )}
        <span className="bubble-time">
          {new Date(message.timestamp).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      {isUser && (
        <div className="bubble-avatar bubble-avatar--user" aria-label="You">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── Loading Indicator ────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="bubble-row bubble-row--ai">
      <div className="bubble-avatar bubble-avatar--ai">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
      <div className="bubble bubble--ai bubble--typing">
        <div className="typing-indicator">
          <span className="typing-label">Drafting legal response</span>
          <div className="typing-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar Session Item ─────────────────────────────────────────────────────
function SessionItem({ session, isActive, onClick, onDelete }) {
  return (
    <div
      className={`session-item ${isActive ? "session-item--active" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="session-icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
      <div className="session-info">
        <span className="session-title">{session.title}</span>
        <span className="session-meta">
          {new Date(session.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })}
        </span>
      </div>
      <button
        className="session-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
        aria-label="Delete session"
        title="Delete"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4h6v2" />
        </svg>
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem("smart-rti-sessions");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return parsed;
      }
    } catch {}
    return [createSession("My First RTI Query")];
  });

  const [currentSessionId, setCurrentSessionId] = useState(() => {
    try {
      return localStorage.getItem("smart-rti-active") || sessions[0]?.id;
    } catch {
      return sessions[0]?.id;
    }
  });

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      return localStorage.getItem("smart-rti-theme") === "dark";
    } catch {
      return false;
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [apiError, setApiError] = useState(null);

  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Current session
  const currentSession =
    sessions.find((s) => s.id === currentSessionId) || sessions[0];
  const chatHistory = currentSession?.messages || [];

  // ── Persist state ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem("smart-rti-sessions", JSON.stringify(sessions));
    } catch {}
  }, [sessions]);

  useEffect(() => {
    try {
      localStorage.setItem("smart-rti-active", currentSessionId);
    } catch {}
  }, [currentSessionId]);

  useEffect(() => {
    try {
      localStorage.setItem("smart-rti-theme", isDarkMode ? "dark" : "light");
    } catch {}
  }, [isDarkMode]);

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      isDarkMode ? "dark" : "light",
    );
  }, [isDarkMode]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isLoading, scrollToBottom]);

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // ── Update session messages helper ────────────────────────────────────────
  const updateSessionMessages = useCallback((sessionId, updater) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, messages: updater(s.messages) } : s,
      ),
    );
  }, []);

  // ── Update session title ──────────────────────────────────────────────────
  const updateSessionTitle = useCallback((sessionId, text) => {
    const title = text.length > 40 ? text.slice(0, 38) + "…" : text;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId && s.title === "New Grievance" ? { ...s, title } : s,
      ),
    );
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setApiError(null);
    setInput("");

    const userMsg = {
      id: generateId(),
      role: "user",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    const sessionId = currentSessionId;
    updateSessionMessages(sessionId, (msgs) => [...msgs, userMsg]);
    if (chatHistory.length <= 1) updateSessionTitle(sessionId, trimmed);

    setIsLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        throw new Error("MISSING_API_KEY");
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: SYSTEM_PROMPT,
      });

      // Build history for context (exclude welcome msg, use last 10)
      const historyMsgs = chatHistory
        .filter((m) => m.id !== "welcome" && !m.isError)
        .slice(-10);

      const geminiHistory = historyMsgs.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }],
      }));

      const chat = model.startChat({ history: geminiHistory });
      const result = await chat.sendMessage(trimmed);
      const responseText = result.response.text();

      const aiMsg = {
        id: generateId(),
        role: "ai",
        text: responseText,
        timestamp: new Date().toISOString(),
      };

      updateSessionMessages(sessionId, (msgs) => [...msgs, aiMsg]);
    } catch (err) {
      console.error("Smart-RTI API Error:", err);

      let errorText = "⚠️ System busy. Please try again in a moment.";

      if (err.message === "MISSING_API_KEY") {
        errorText =
          "⚠️ **API Key Missing.** Please set `VITE_GEMINI_API_KEY` in your `.env` file and restart the dev server.";
      } else if (
        err.message?.includes("API_KEY_INVALID") ||
        err.message?.includes("400")
      ) {
        errorText =
          "⚠️ **Invalid API Key.** Please check your Gemini API key in `.env`.";
      } else if (
        err.message?.includes("429") ||
        err.message?.includes("quota")
      ) {
        errorText =
          "⚠️ **API quota exceeded.** You've hit the rate limit. Please wait a few minutes and try again.";
      } else if (
        err.message?.includes("fetch") ||
        err.message?.includes("network") ||
        err.name === "TypeError"
      ) {
        errorText =
          "⚠️ **Network error.** Please check your internet connection and try again.";
      } else if (err.message?.includes("500") || err.message?.includes("503")) {
        errorText =
          "⚠️ **Gemini service temporarily unavailable.** Please try again shortly.";
      }

      setApiError(errorText);
      updateSessionMessages(sessionId, (msgs) => [
        ...msgs,
        {
          id: generateId(),
          role: "ai",
          text: errorText,
          isError: true,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }, [
    input,
    isLoading,
    currentSessionId,
    chatHistory,
    updateSessionMessages,
    updateSessionTitle,
  ]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Session management ────────────────────────────────────────────────────
  const newSession = () => {
    const s = createSession("New Grievance");
    setSessions((prev) => [s, ...prev]);
    setCurrentSessionId(s.id);
    setSidebarOpen(false);
    setInput("");
    setApiError(null);
  };

  const deleteSession = (id) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createSession("My First RTI Query");
        setCurrentSessionId(fresh.id);
        return [fresh];
      }
      if (currentSessionId === id) {
        setCurrentSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  const switchSession = (id) => {
    setCurrentSessionId(id);
    setSidebarOpen(false);
    setInput("");
    setApiError(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={`app-root ${isDarkMode ? "dark" : "light"}`}>
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <aside
        className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}
        aria-label="Navigation"
      >
        {/* Sidebar Header */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-brand-icon">
              <svg viewBox="0 0 32 32" fill="none">
                <circle
                  cx="16"
                  cy="16"
                  r="15"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M8 16h16M16 8v16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle
                  cx="16"
                  cy="16"
                  r="4"
                  fill="currentColor"
                  opacity="0.3"
                />
              </svg>
            </div>
            <span className="sidebar-brand-name">Smart-RTI</span>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* New Grievance Button */}
        <div className="sidebar-new">
          <button className="btn-new-grievance" onClick={newSession}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Grievance
          </button>
        </div>

        {/* Sessions List */}
        <div className="sidebar-sessions-label">Recent Queries</div>
        <nav className="sidebar-sessions" aria-label="Chat sessions">
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === currentSessionId}
              onClick={() => switchSession(session.id)}
              onDelete={deleteSession}
            />
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-info-badge">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            RTI Act, 2005
          </div>
          <div className="theme-toggle-wrapper">
            <span className="theme-label">
              {isDarkMode ? "Dark Mode" : "Light Mode"}
            </span>
            <button
              className={`theme-toggle ${isDarkMode ? "theme-toggle--dark" : ""}`}
              onClick={() => setIsDarkMode((d) => !d)}
              aria-label="Toggle theme"
            >
              <div className="theme-toggle-thumb">
                {isDarkMode ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="5" />
                    <line
                      x1="12"
                      y1="1"
                      x2="12"
                      y2="3"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <line
                      x1="12"
                      y1="21"
                      x2="12"
                      y2="23"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <line
                      x1="4.22"
                      y1="4.22"
                      x2="5.64"
                      y2="5.64"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <line
                      x1="18.36"
                      y1="18.36"
                      x2="19.78"
                      y2="19.78"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <line
                      x1="1"
                      y1="12"
                      x2="3"
                      y2="12"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <line
                      x1="21"
                      y1="12"
                      x2="23"
                      y2="12"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <line
                      x1="4.22"
                      y1="19.78"
                      x2="5.64"
                      y2="18.36"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <line
                      x1="18.36"
                      y1="5.64"
                      x2="19.78"
                      y2="4.22"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </div>
            </button>
          </div>
          <div className="sidebar-powered">Powered by Gemini 2.0 Flash</div>
        </div>
      </aside>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
      <main className="main-panel" aria-label="Chat area">
        {/* Sticky Header */}
        <header className="chat-header">
          <div className="chat-header-left">
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              aria-expanded={sidebarOpen}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="header-brand">
              <div className="header-brand-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32" fill="none">
                  <circle
                    cx="16"
                    cy="16"
                    r="15"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M8 16h16M16 8v16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="16"
                    cy="16"
                    r="4"
                    fill="currentColor"
                    opacity="0.3"
                  />
                </svg>
              </div>
              <div className="header-brand-text">
                <h1 className="header-title">Smart-RTI</h1>
                <span className="header-subtitle">
                  Legal Assistant · RTI Act 2005
                </span>
              </div>
            </div>
          </div>
          <div className="chat-header-right">
            <div className="live-indicator" role="status" aria-label="Online">
              <span className="live-dot" aria-hidden="true"></span>
              <span className="live-text">Online</span>
            </div>
            <a
              href="https://rtionline.gov.in"
              target="_blank"
              rel="noopener noreferrer"
              className="portal-link"
              title="Open RTI Online Portal"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              RTI Portal
            </a>
          </div>
        </header>

        {/* Session Title Bar */}
        <div className="session-title-bar">
          <div className="session-title-bar-inner">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <span>{currentSession?.title || "New Grievance"}</span>
          </div>
        </div>

        {/* Chat Messages */}
        <div
          className="chat-area"
          ref={chatContainerRef}
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
        >
          <div className="chat-messages">
            {chatHistory.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={chatEndRef} className="chat-end-anchor" />
          </div>
        </div>

        {/* Quick Action Chips */}
        {chatHistory.length <= 1 && !isLoading && (
          <div
            className="quick-chips"
            role="list"
            aria-label="Quick start prompts"
          >
            {[
              "How do I file an RTI application?",
              "What is the RTI fee for Non-BPL applicant?",
              "How to track my RTI status?",
              "How to file a First Appeal?",
            ].map((q) => (
              <button
                key={q}
                className="chip"
                role="listitem"
                onClick={() => {
                  setInput(q);
                  textareaRef.current?.focus();
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input Area */}
        <div className="input-area">
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about RTI filing, fees, status, appeals… (Enter to send)"
              disabled={isLoading}
              rows={1}
              aria-label="Message input"
              maxLength={3000}
            />
            <div className="input-actions">
              {input.length > 0 && (
                <span
                  className="char-count"
                  aria-label={`${input.length} characters`}
                >
                  {input.length}/3000
                </span>
              )}
              <button
                className={`send-btn ${input.trim() && !isLoading ? "send-btn--active" : ""}`}
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
              >
                {isLoading ? (
                  <svg
                    className="spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <p className="input-hint">
            <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line ·
            Only RTI-related queries
          </p>
        </div>
      </main>
    </div>
  );
}
