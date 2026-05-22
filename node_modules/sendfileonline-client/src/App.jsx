import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";

const API_BASE = "http://localhost:5000/api";
const SOCKET_URL = "http://localhost:5000";

const api = axios.create({
  baseURL: API_BASE
});

const features = [
  {
    title: "Large file sharing",
    description: "Send massive files quickly with fast resume and encrypted transfer."
  },
  {
    title: "6-digit share code",
    description: "Share by code or secure link—no sign-up required."
  },
  {
    title: "Track downloads",
    description: "See when and where your files are opened."
  },
  {
    title: "Free up to 1GB",
    description: "Upgrade to Pro for massive transfers and priority routing."
  }
];

const pricing = [
  {
    plan: "Free",
    price: "$0",
    details: ["1GB per transfer", "7-day expiry", "Basic analytics"],
    cta: "Start free"
  },
  {
    plan: "Pro",
    price: "$9/mo",
    details: ["50GB per transfer", "Custom expiry", "Password protection"],
    cta: "Upgrade"
  },
  {
    plan: "Teams",
    price: "$29/mo",
    details: ["Shared workspaces", "Audit trails", "Priority support"],
    cta: "Talk to sales"
  }
];

const faqItems = [
  {
    q: "Do recipients need an account?",
    a: "No. Anyone with a share link or 6-digit code can download."
  },
  {
    q: "How long do files stay online?",
    a: "Free transfers stay for 7 days. Pro users can customize expiry."
  },
  {
    q: "Is it secure?",
    a: "TLS in transit and encryption-at-rest (planned) keep files safe."
  }
];

export default function App() {
  const [authMode, setAuthMode] = useState("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPlan, setAuthPlan] = useState("free");
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("authToken") || "");
  const [authUser, setAuthUser] = useState(null);
  const [authError, setAuthError] = useState("");
  const [share, setShare] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filename, setFilename] = useState("project.zip");
  const [size, setSize] = useState(860);
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState("free");
  const [password, setPassword] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [expiresAfterDownload, setExpiresAfterDownload] = useState(false);
  const [region, setRegion] = useState("us");
  const [emailShare, setEmailShare] = useState("");
  const [encryptEnabled, setEncryptEnabled] = useState(false);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupPassword, setLookupPassword] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [dashboardShares, setDashboardShares] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [deletedShares, setDeletedShares] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [p2pSession, setP2pSession] = useState("");
  const [p2pStatus, setP2pStatus] = useState("idle");
  const [p2pFile, setP2pFile] = useState(null);
  const [p2pIncoming, setP2pIncoming] = useState(null);
  const [p2pLog, setP2pLog] = useState([]);
  const [iceServers, setIceServers] = useState([{ urls: "stun:stun.l.google.com:19302" }]);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const incomingRef = useRef({ meta: null, size: 0, chunks: [] });
  const p2pSessionRef = useRef("");

  const fileSizeLabel = useMemo(() => `${size} MB`, [size]);

  const appendLog = (message) => {
    setP2pLog((prev) => [...prev.slice(-6), message]);
  };

  const setAuthSession = (token, user) => {
    setAuthToken(token);
    setAuthUser(user);
    if (user?.plan) {
      setPlan(user.plan);
    }
    if (token) {
      localStorage.setItem("authToken", token);
    } else {
      localStorage.removeItem("authToken");
    }
  };

  const handleAuth = async () => {
    setAuthError("");
    try {
      if (authMode === "register") {
        const response = await api.post("/auth/register", {
          name: authName,
          email: authEmail,
          password: authPassword,
          plan: authPlan
        });
        setAuthSession(response.data.token, response.data.user);
      } else {
        const response = await api.post("/auth/login", {
          email: authEmail,
          password: authPassword
        });
        setAuthSession(response.data.token, response.data.user);
      }
    } catch (error) {
      console.error(error);
      setAuthError("Auth failed. Check credentials.");
    }
  };

  const logout = () => {
    setAuthSession("", null);
  };

  const arrayBufferToBase64 = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)));

  const base64ToArrayBuffer = (base64) =>
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;

  const deriveKey = async (secret, salt) => {
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  };

  const encryptBlob = async (inputFile, secret) => {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const buffer = await inputFile.arrayBuffer();
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      buffer
    );
    return {
      blob: new Blob([encrypted], { type: "application/octet-stream" }),
      salt: arrayBufferToBase64(salt),
      iv: arrayBufferToBase64(iv)
    };
  };

  const decryptBuffer = async (buffer, secret, salt, iv) => {
    const key = await deriveKey(secret, new Uint8Array(base64ToArrayBuffer(salt)));
    return window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToArrayBuffer(iv)) },
      key,
      buffer
    );
  };

  const createShare = async () => {
    setLoading(true);
    try {
      const payload = new FormData();
      let uploadFile = file;
      if (!uploadFile) {
        const blob = new Blob([`Mock file: ${filename}`], { type: "text/plain" });
        uploadFile = new File([blob], filename, { type: "text/plain" });
      }

      if (encryptEnabled) {
        if (!password) {
          setShare({ error: "Password required for encryption." });
          setLoading(false);
          return;
        }
        const encrypted = await encryptBlob(uploadFile, password);
        payload.append("file", new File([encrypted.blob], uploadFile.name, { type: uploadFile.type }));
        payload.append("encrypted", "true");
        payload.append("encryptionSalt", encrypted.salt);
        payload.append("encryptionIv", encrypted.iv);
      } else {
        payload.append("file", uploadFile);
        payload.append("encrypted", "false");
      }
      payload.append("expiresInDays", expiresInDays.toString());
      payload.append("expiresAfterDownload", expiresAfterDownload.toString());
      payload.append("plan", plan);
      payload.append("password", password);
      payload.append("region", region);
      payload.append("recipientEmails", emailShare);

      const response = await api.post("/shares", payload, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setShare(response.data.share);
      setEmailShare("");
      fetchDashboard();
    } catch (error) {
      console.error(error);
      setShare({ error: "Unable to reach server. Start the backend first." });
    } finally {
      setLoading(false);
    }
  };

  const lookupShare = async () => {
    if (!lookupCode.trim()) {
      return;
    }
    setDownloadError("");
    try {
      const response = await api.get(`/shares/${lookupCode.trim()}`, {
        params: lookupPassword ? { password: lookupPassword } : {}
      });
      setLookupResult(response.data.share);
    } catch (error) {
      console.error(error);
      setLookupResult({ error: "Share not found or password incorrect." });
    }
  };

  const decryptAndDownload = async () => {
    if (!lookupResult) {
      return;
    }
    setDownloadError("");
    if (!lookupPassword) {
      setDownloadError("Password required for decryption.");
      return;
    }
    try {
      const response = await fetch(
        `${API_BASE}/shares/${lookupResult.code}/download?password=${encodeURIComponent(lookupPassword)}`
      );
      if (!response.ok) {
        throw new Error("Download failed");
      }
      const encryptedBuffer = await response.arrayBuffer();
      const decrypted = await decryptBuffer(
        encryptedBuffer,
        lookupPassword,
        lookupResult.encryptionSalt,
        lookupResult.encryptionIv
      );
      const blob = new Blob([decrypted], { type: lookupResult.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = lookupResult.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      setDownloadError("Unable to decrypt file.");
    }
  };

  const fetchDashboard = async () => {
    if (!authToken) {
      setDashboardShares([]);
      return;
    }
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const response = await api.get("/shares");
      setDashboardShares(response.data.shares || []);
    } catch (error) {
      console.error(error);
      setDashboardError("Unable to load dashboard.");
    } finally {
      setDashboardLoading(false);
    }
  };

  const fetchDeleted = async () => {
    if (!authToken) {
      setDeletedShares([]);
      return;
    }
    setDeletedLoading(true);
    try {
      const response = await api.get("/shares/deleted");
      setDeletedShares(response.data.shares || []);
    } catch (error) {
      console.error(error);
    } finally {
      setDeletedLoading(false);
    }
  };

  const deleteShare = async (code) => {
    try {
      await api.delete(`/shares/${code}`);
      fetchDashboard();
      fetchDeleted();
    } catch (error) {
      console.error(error);
    }
  };

  const sendEmailShare = async () => {
    if (!share?.code || !emailShare.trim()) {
      return;
    }
    try {
      await api.post(`/shares/${share.code}/email`, { emails: emailShare });
      setEmailShare("");
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchDashboard();
    fetchDeleted();
  }, []);

  useEffect(() => {
    if (authToken) {
      api.defaults.headers.common.Authorization = `Bearer ${authToken}`;
      fetchDashboard();
      fetchDeleted();
    } else {
      delete api.defaults.headers.common.Authorization;
    }
  }, [authToken]);

  useEffect(() => {
    const fetchIce = async () => {
      try {
        const response = await fetch(`${API_BASE}/p2p/ice`);
        const data = await response.json();
        if (data.iceServers?.length) {
          setIceServers(data.iceServers);
        }
      } catch (error) {
        console.error(error);
      }
    };
    fetchIce();
  }, []);

  useEffect(() => {
    p2pSessionRef.current = p2pSession;
  }, [p2pSession]);

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on("p2p:signal", async ({ data }) => {
      if (!peerRef.current) {
        await createPeer(false);
      }
      const peer = peerRef.current;
      if (data.type === "offer") {
        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("p2p:signal", { sessionId: p2pSessionRef.current, data: { type: "answer", answer } });
      } else if (data.type === "answer") {
        await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.type === "candidate" && data.candidate) {
        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const setupChannel = (channel) => {
    channelRef.current = channel;
    channel.onopen = () => {
      setP2pStatus("connected");
      appendLog("Data channel open.");
    };
    channel.onclose = () => {
      setP2pStatus("idle");
      appendLog("Data channel closed.");
    };
    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        const meta = JSON.parse(event.data);
        incomingRef.current = { meta, size: 0, chunks: [] };
        appendLog(`Receiving ${meta.name}...`);
        return;
      }
      const buffer = event.data;
      incomingRef.current.chunks.push(buffer);
      incomingRef.current.size += buffer.byteLength;
      if (incomingRef.current.size >= incomingRef.current.meta.size) {
        const blob = new Blob(incomingRef.current.chunks, { type: incomingRef.current.meta.type });
        const url = URL.createObjectURL(blob);
        setP2pIncoming({ name: incomingRef.current.meta.name, url });
        appendLog(`Received ${incomingRef.current.meta.name}.`);
      }
    };
  };

  const createPeer = async (isInitiator) => {
    if (peerRef.current) {
      peerRef.current.close();
    }
    const peer = new RTCPeerConnection({
      iceServers
    });
    peerRef.current = peer;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("p2p:signal", {
          sessionId: p2pSessionRef.current,
          data: { type: "candidate", candidate: event.candidate }
        });
      }
    };

    peer.onconnectionstatechange = () => {
      appendLog(`Connection state: ${peer.connectionState}`);
    };

    if (isInitiator) {
      const channel = peer.createDataChannel("file");
      setupChannel(channel);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socketRef.current?.emit("p2p:signal", {
        sessionId: p2pSessionRef.current,
        data: { type: "offer", offer }
      });
    } else {
      peer.ondatachannel = (event) => {
        setupChannel(event.channel);
      };
    }

    return peer;
  };

  const startP2PSession = async () => {
    const sessionId = Math.random().toString(36).slice(2, 8).toUpperCase();
    setP2pSession(sessionId);
    p2pSessionRef.current = sessionId;
    setP2pStatus("waiting");
    appendLog(`Session created: ${sessionId}`);
    socketRef.current?.emit("p2p:create", { sessionId });
    await createPeer(true);
  };

  const joinP2PSession = async () => {
    if (!p2pSession.trim()) {
      return;
    }
    p2pSessionRef.current = p2pSession.trim();
    setP2pStatus("joining");
    appendLog(`Joining session ${p2pSession}`);
    socketRef.current?.emit("p2p:join", { sessionId: p2pSession });
    await createPeer(false);
  };

  const sendP2PFile = async () => {
    if (!channelRef.current || channelRef.current.readyState !== "open" || !p2pFile) {
      appendLog("Data channel not ready or no file selected.");
      return;
    }
    const meta = { name: p2pFile.name, size: p2pFile.size, type: p2pFile.type };
    channelRef.current.send(JSON.stringify(meta));
    const buffer = await p2pFile.arrayBuffer();
    const chunkSize = 16 * 1024;
    for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
      const chunk = buffer.slice(offset, offset + chunkSize);
      channelRef.current.send(chunk);
    }
    appendLog(`Sent ${p2pFile.name}.`);
  };

  return (
    <div className="page">
      <div className="background-orbs" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <span className="orb orb-3" />
      </div>
      <header className="nav">
        <div className="logo">SendFileOnline Pro</div>
        <nav>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <button className="btn ghost">Sign in</button>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="badge">No login • 6-digit share code • Instant link</span>
          <h1>Send large files online, instantly.</h1>
          <p>
            SendFileOnline Pro is an improved, MERN-powered experience for fast
            file sharing. Generate a code, share a link, and track downloads in
            real-time.
          </p>
          <div className="hero-actions">
            <button className="btn primary" onClick={createShare}>
              {loading ? "Generating..." : "Generate share code"}
            </button>
            <button className="btn ghost">Watch demo</button>
          </div>
          <div className="auth-card">
            <h3>{authToken ? `Welcome, ${authUser?.name || "User"}` : "Account"}</h3>
            {authToken ? (
              <>
                <p className="hint">Plan: {authUser?.plan || "free"}</p>
                <button className="btn ghost" onClick={logout}>
                  Logout
                </button>
              </>
            ) : (
              <>
                <div className="auth-toggle">
                  <button className={authMode === "login" ? "btn primary" : "btn ghost"} onClick={() => setAuthMode("login")}>
                    Login
                  </button>
                  <button className={authMode === "register" ? "btn primary" : "btn ghost"} onClick={() => setAuthMode("register")}>
                    Register
                  </button>
                </div>
                {authMode === "register" ? (
                  <input
                    placeholder="Name"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                  />
                ) : null}
                <input
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
                {authMode === "register" ? (
                  <select value={authPlan} onChange={(e) => setAuthPlan(e.target.value)}>
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="teams">Teams</option>
                  </select>
                ) : null}
                {authError ? <p className="error">{authError}</p> : null}
                <button className="btn secondary" onClick={handleAuth}>
                  {authMode === "register" ? "Create account" : "Sign in"}
                </button>
              </>
            )}
          </div>
          <div className="share-card">
            {share?.error ? (
              <p className="error">{share.error}</p>
            ) : share ? (
              <>
                <p>
                  Share code: <strong>{share.code}</strong>
                </p>
                <p>
                  Link: <a href={share.link}>{share.link}</a>
                </p>
                <p>
                  Download: <a href={share.downloadUrl}>{share.downloadUrl}</a>
                </p>
                <p>Expires: {new Date(share.expiresAt).toLocaleDateString()}</p>
                {share.passwordRequired ? <p>Password protected ✅</p> : null}
                {share.encrypted ? <p>Encrypted (AES-256) ✅</p> : null}
                {share.recipientEmails?.length ? (
                  <p>Shared with: {share.recipientEmails.join(", ")}</p>
                ) : null}
                <div className="email-share">
                  <input
                    placeholder="Add recipient emails"
                    value={emailShare}
                    onChange={(e) => setEmailShare(e.target.value)}
                  />
                  <button className="btn secondary" onClick={sendEmailShare}>
                    Send email
                  </button>
                </div>
              </>
            ) : (
              <p>Generate a share code to see your link.</p>
            )}
          </div>
          <div className="stats">
            <div>
              <strong>1GB</strong>
              <span>Free per transfer</span>
            </div>
            <div>
              <strong>6-digit</strong>
              <span>Share codes</span>
            </div>
            <div>
              <strong>Instant</strong>
              <span>Link delivery</span>
            </div>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="visual-card glass">
            <div className="visual-header">
              <span>Live transfer</span>
              <span className="status-pill">Encrypted</span>
            </div>
            <div className="visual-body">
              <div className="progress">
                <div className="progress-bar" />
              </div>
              <div className="visual-stats">
                <div>
                  <strong>1.4 GB</strong>
                  <span>Uploading</span>
                </div>
                <div>
                  <strong>72%</strong>
                  <span>Complete</span>
                </div>
              </div>
            </div>
          </div>
          <div className="visual-card floating">
            <p>Share code</p>
            <h3>482 911</h3>
            <span className="pill">Valid 7 days</span>
          </div>
          <div className="visual-card floating alt">
            <p>Active downloads</p>
            <h3>24</h3>
            <span className="pill">Global</span>
          </div>
          <div className="visual-ring" />
        </div>

        <div className="upload-panel">
          <div className="panel-header">
            <span>Send a file</span>
            <span className="pill">Encrypted</span>
          </div>
          <div className="panel-body">
            <label>
              File name
              <input value={filename} onChange={(e) => setFilename(e.target.value)} />
            </label>
            <label>
              Plan
              <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="free">Free (1GB, 5/week)</option>
                <option value="pro">Pro (10GB)</option>
                <option value="teams">Teams (100GB)</option>
              </select>
            </label>
            <label>
              Choose file
              <input
                type="file"
                onChange={(e) => {
                  const selected = e.target.files?.[0] ?? null;
                  setFile(selected);
                  if (selected) {
                    setFilename(selected.name);
                    setSize(Math.round(selected.size / (1024 * 1024)) || 1);
                  }
                }}
              />
            </label>
            <label>
              File size (MB)
              <input
                type="number"
                value={size}
                min={50}
                max={50000}
                onChange={(e) => setSize(Number(e.target.value))}
              />
            </label>
            <label>
              Password (Pro)
              <input
                type="password"
                value={password}
                placeholder="Optional"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={encryptEnabled}
                onChange={(e) => setEncryptEnabled(e.target.checked)}
              />
              AES-256 encryption (requires password)
            </label>
            <label>
              Expiry (days)
              <input
                type="number"
                value={expiresInDays}
                min={1}
                max={plan === "free" ? 7 : 30}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={expiresAfterDownload}
                onChange={(e) => setExpiresAfterDownload(e.target.checked)}
              />
              Expire after first download
            </label>
            <label>
              Region
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="us">US</option>
                <option value="eu">EU</option>
                <option value="asia">Asia</option>
              </select>
            </label>
            <label>
              Share via email
              <input
                value={emailShare}
                placeholder="name@example.com, team@company.com"
                onChange={(e) => setEmailShare(e.target.value)}
              />
            </label>
            <button className="btn secondary" onClick={createShare}>
              {loading ? "Preparing..." : "Create share link"}
            </button>
            <p className="hint">Files are stored locally on the server for now.</p>
          </div>
          <div className="panel-footer">
            <span>Estimated size: {fileSizeLabel}</span>
            <span>Expiry: {expiresAfterDownload ? "After download" : `${expiresInDays} days`}</span>
          </div>
        </div>
      </section>

      <section className="section alt">
        <h2>Download by code</h2>
        <div className="download-box">
          <input
            placeholder="Enter 6-digit code"
            value={lookupCode}
            onChange={(e) => setLookupCode(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password (if required)"
            value={lookupPassword}
            onChange={(e) => setLookupPassword(e.target.value)}
          />
          <button className="btn primary" onClick={lookupShare}>
            Find file
          </button>
        </div>
        {downloadError ? <p className="error">{downloadError}</p> : null}
        {lookupResult?.error ? (
          <p className="error">{lookupResult.error}</p>
        ) : lookupResult ? (
          <div className="share-card">
            <p>
              <strong>{lookupResult.filename}</strong> • {Math.round(lookupResult.size / 1024 / 1024)} MB
            </p>
            <p>Downloads: {lookupResult.downloads ?? 0}</p>
            <p>Region: {lookupResult.region ?? "global"}</p>
            <div className="download-actions">
              <a
                href={`${API_BASE}/shares/${lookupResult.code}/download?password=${encodeURIComponent(lookupPassword)}`}
              >
                Download now
              </a>
              {lookupResult.encrypted ? (
                <button className="btn secondary" onClick={decryptAndDownload}>
                  Decrypt & download
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="section" id="dashboard">
        <div className="section-header">
          <h2>File management dashboard</h2>
          <button className="btn ghost" onClick={fetchDashboard}>
            Refresh
          </button>
        </div>
        {!authToken ? <p className="hint">Login to access your dashboard.</p> : null}
        {dashboardLoading ? <p>Loading...</p> : null}
        {dashboardError ? <p className="error">{dashboardError}</p> : null}
        <div className="grid">
          {(authToken ? dashboardShares : []).map((item) => (
            <div key={item.code} className="card">
              <h3>{item.filename}</h3>
              <p>Code: {item.code}</p>
              <p>Plan: {item.plan}</p>
              <p>Downloads: {item.downloads ?? 0}</p>
              <p>Expiry: {new Date(item.expiresAt).toLocaleDateString()}</p>
              {item.encrypted ? <p className="hint">Encrypted</p> : null}
              {item.lastDownload ? (
                <p className="hint">
                  Last download: {new Date(item.lastDownload.timestamp).toLocaleString()} • {item.lastDownload.region}
                </p>
              ) : (
                <p className="hint">No downloads yet.</p>
              )}
              <button className="btn ghost" onClick={() => deleteShare(item.code)}>
                Delete file
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="section alt">
        <div className="section-header">
          <h2>Deleted files history</h2>
          <button className="btn ghost" onClick={fetchDeleted}>
            Refresh
          </button>
        </div>
        {deletedLoading ? <p>Loading...</p> : null}
        <div className="grid">
          {deletedShares.map((item) => (
            <div key={`${item.code}-deleted`} className="card">
              <h3>{item.filename}</h3>
              <p>Code: {item.code}</p>
              <p>Deleted: {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : ""}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section alt">
        <h2>Peer-to-peer transfer (WebRTC)</h2>
        <p>Transfer files directly between devices with WebRTC data channels.</p>
        <div className="p2p-grid">
          <div className="card">
            <h3>Create session</h3>
            <button className="btn secondary" onClick={startP2PSession}>
              Start P2P session
            </button>
            {p2pSession ? <p className="hint">Session code: {p2pSession}</p> : null}
          </div>
          <div className="card">
            <h3>Join session</h3>
            <input
              placeholder="Enter session code"
              value={p2pSession}
              onChange={(e) => setP2pSession(e.target.value.toUpperCase())}
            />
            <button className="btn ghost" onClick={joinP2PSession}>
              Join
            </button>
          </div>
          <div className="card">
            <h3>Send file</h3>
            <input type="file" onChange={(e) => setP2pFile(e.target.files?.[0] ?? null)} />
            <button className="btn primary" onClick={sendP2PFile}>
              Send via P2P
            </button>
            {p2pIncoming ? (
              <a className="p2p-download" href={p2pIncoming.url} download={p2pIncoming.name}>
                Download {p2pIncoming.name}
              </a>
            ) : null}
          </div>
        </div>
        <div className="p2p-log">
          <strong>Status:</strong> {p2pStatus}
          <ul>
            {p2pLog.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section id="features" className="section">
        <h2>Why teams use SendFileOnline Pro</h2>
        <div className="grid">
          {features.map((item) => (
            <div key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="section alt">
        <h2>How it works</h2>
        <div className="steps">
          <div>
            <span>1</span>
            <h3>Upload</h3>
            <p>Select your files and set an expiry.</p>
          </div>
          <div>
            <span>2</span>
            <h3>Share</h3>
            <p>Send a 6-digit code or secure link.</p>
          </div>
          <div>
            <span>3</span>
            <h3>Track</h3>
            <p>Monitor downloads and secure access.</p>
          </div>
        </div>
      </section>

      <section id="pricing" className="section">
        <h2>Pricing that scales with you</h2>
        <div className="grid">
          {pricing.map((tier) => (
            <div key={tier.plan} className="card pricing">
              <h3>{tier.plan}</h3>
              <p className="price">{tier.price}</p>
              <ul>
                {tier.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              <button className="btn primary">{tier.cta}</button>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="section alt">
        <h2>FAQ</h2>
        <div className="grid">
          {faqItems.map((item) => (
            <div key={item.q} className="card">
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <div>
          <strong>SendFileOnline Pro</strong>
          <p>Modern file sharing for product teams.</p>
        </div>
        <div className="footer-links">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
      </footer>
    </div>
  );
}
