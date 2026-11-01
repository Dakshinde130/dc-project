# Distributed Computing Interactive Lab Suite 🌐

An interactive, full-stack visualizer and execution suite for Distributed Systems concepts, protocols, and algorithms. Built with **Next.js 16**, **TypeScript**, **Tailwind CSS**, and **Node.js** processes.

---

## 🚀 Features & Modules

1. **Overview**: Live dashboard summarizing all 10 protocols and algorithms.
2. **TCP Messaging (`scripts/tcp-server.js`)**: Real raw TCP socket broker with fresh connection handshakes vs. persistent connection pooling comparison and round-trip timing.
3. **UDP Notifications (`scripts/udp-notifier.js`)**: Real UDP datagram broadcast/multicast simulation highlighting packet loss and fire-and-forget behavior.
4. **XML-RPC (`scripts/xmlrpc-server.js`)**: Standard XML payload marshaling and remote procedure calls over HTTP.
5. **Java RMI (`java/rmi-lab`)**: Java Remote Method Invocation reference implementation (Calculator interface, skeleton, registry, and client).
6. **Distributed File Sharing**: Chunked file upload, shared storage cluster simulator, and SHA-256 hash integrity checks.
7. **Round Robin Load Balancing (`scripts/backend-server.js`)**: Load balancer dispatching HTTP requests across 3 live backend worker instances.
8. **Berkeley Clock Synchronization**: Process clocks with random drift converging via a master coordinator calculating fault-tolerant average time.
9. **Ricart–Agrawala Algorithm**: Distributed mutual exclusion with timestamped requests and permission grants without a single point of failure.
10. **Distributed Deadlock Detection**: Distributed wait-for graph (WFG), cycle detection algorithms, and automatic victim preemption.
11. **MapReduce**: Split text input, distribute map jobs to worker nodes, shuffle intermediate key-values, and reduce to word counts.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (Turbopack, App Router)
- **Frontend**: React 19, Tailwind CSS, Lucide Icons
- **Backend / Networking**: Node.js child processes, `net` (TCP), `dgram` (UDP), HTTP
- **Database (Optional)**: Drizzle ORM + PostgreSQL (safe fallback if database is not configured)
- **Language**: TypeScript & JavaScript, Java for RMI references

---

## 💻 Local Setup & Development

### Prerequisites
- [Node.js](https://nodejs.org/) v18+ (v20+ recommended)
- Git

### 1. Clone & Install
```bash
git clone https://github.com/<YOUR-USERNAME>/<REPO-NAME>.git
cd <REPO-NAME>
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Production Build
```bash
npm run build
npm start
```

---

## ☁️ Deployment

### Option 1: Render (Recommended for Full Functionality)
Because this project utilizes background Node.js worker processes and TCP/UDP sockets, deploying as a continuous container or Node service is ideal.

1. Push your repository to **GitHub**.
2. Sign in to [Render](https://render.com/).
3. Click **New +** > **Web Service**.
4. Connect your GitHub repository.
5. Configure:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
6. Click **Deploy Web Service**. Render gives you a free live URL (e.g. `https://your-app.onrender.com`).

---

### Option 2: Railway or Docker
1. Create a new project on [Railway](https://railway.app/).
2. Select **Deploy from GitHub repo**.
3. Railway will automatically detect Next.js and run `npm run build` and `npm start`.

---

### Option 3: Vercel (Quick Frontend Preview)
> **Note**: On serverless platforms like Vercel, client-side algorithms (Berkeley, Ricart-Agrawala, Deadlock, UI) work smoothly, but child processes and raw TCP/UDP server sockets cannot persist. For full process/socket supervision, use Render or Railway.

1. Import your repo on [Vercel](https://vercel.com/new).
2. Click **Deploy**.

