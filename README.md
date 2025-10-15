# 🧠 Coderide Potpie Service — BullMQ Queue System

A robust, scalable microservice for analyzing GitHub repositories using [Potpie.ai](https://potpie.ai) APIs with BullMQ queue management. This service provides asynchronous processing, automatic retries, and real-time WebSocket updates for production-grade repository analysis.

## 📁 Project Structure

```
coderide-potpie-service/
├── src/
│   ├── index.js              # Main Express server with BullMQ integration
│   ├── potpieClient.js       # Potpie API v2 client
│   ├── redisConfig.js        # Redis connection with TLS support
│   └── analysisWorker.js     # BullMQ worker for processing jobs
├── certs/                    # TLS certificates for Redis (if needed)
├── kubernetes/
│   ├── deployment.yaml       # Kubernetes deployment with secrets
│   └── service.yaml          # Kubernetes service and ingress
├── Dockerfile                # Docker container configuration
├── package.json              # Node.js dependencies and scripts
├── .env.example              # Environment variables template
├── test-service.js           # Basic API test suite
├── websocket-test-client.js  # WebSocket integration test client
└── README.md                 # This file
```

## ⚙️ Prerequisites

- Node.js 20+
- Redis server (for BullMQ queues)
- Docker
- Kubernetes cluster (e.g., AWS Lightsail)
- Potpie.ai API key
- GitHub token for private repositories

## 🚀 Quick Start

### 1. Environment Setup

Copy the environment template and configure your settings:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=8080
POTPIE_API_KEY=your_actual_potpie_api_key_here

# Redis Configuration for BullMQ
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=1
REDIS_USERNAME=default

# Redis TLS (if needed)
REDIS_TLS_ENABLED=false
REDIS_TLS_CERT_PATH=./certs/redis-client.crt

# BullMQ Configuration
MAX_CONCURRENT_JOBS=5
MAX_RETRIES=3
QUEUE_NAME=potpie-analysis
```

### 2. Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The service will be available at `http://localhost:8080`

### 3. Test the Service

Basic health check:

```bash
curl http://localhost:8080/
```

Queue statistics:

```bash
curl http://localhost:8080/queue/stats
```

Start repository analysis:

```bash
curl -X POST http://localhost:8080/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "org/repository-name",
    "branch": "main",
    "question": "Explain the authentication module",
    "github_token": "ghp_xxxxxxxxxxxxxxxxxxxx"
  }'
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Basic health check |
| GET | `/health` | Detailed health check with Redis and queue status |
| POST | `/analyze` | Start asynchronous repository analysis |
| GET | `/status/:projectId` | Check analysis job status |
| GET | `/queue/stats` | Queue statistics and monitoring |
| WebSocket | `/` | Real-time analysis updates |

## 🔄 BullMQ Queue Architecture

### **Queue Flow:**
```
POST /analyze → Potpie Parse → BullMQ Queue → Worker → WebSocket Updates
     ↓                           ↓              ↓
project_id ←                Job queued    Processing → Finished
```

### **Job States:**
1. **`queued`** → Job added to BullMQ queue, waiting for worker
2. **`parsing`** → Potpie is parsing the repository
3. **`ready`** → Parsing completed, starting conversations
4. **`processing_conversations`** → Extracting knowledge graph
5. **`finished`** → Analysis complete, data sent via WebSocket
6. **`failed`** → Job failed after retries

### **Queue Features:**
- **Persistence**: Jobs survive service restarts
- **Retry Logic**: 3 automatic retries with exponential backoff
- **Concurrency**: Maximum 5 concurrent jobs
- **Monitoring**: Real-time queue statistics
- **Cleanup**: Automatic removal of old completed/failed jobs

## 📊 POST /analyze

Starts asynchronous repository analysis using BullMQ.

**Request Body:**

```json
{
  "repo": "org/repository-name",
  "branch": "main",
  "question": "Explain the authentication module",
  "github_token": "ghp_xxxxxxxxxxxxxxxxxxxx"
}
```

**Response:**

```json
{
  "success": true,
  "project_id": "abc123",
  "job_id": "abc123",
  "status": "queued",
  "message": "Repository analysis queued. Connect to WebSocket for real-time updates.",
  "websocket_endpoint": "/ws/abc123",
  "queue_position": 2,
  "timestamp": "2025-01-15T18:48:00.000Z"
}
```

## 📈 GET /status/:projectId

Check the status of an analysis job.

**Response:**

```json
{
  "success": true,
  "project_id": "abc123",
  "job_id": "abc123",
  "status": "processing_conversations",
  "progress": 75,
  "queue_position": null,
  "attempts": 1,
  "max_attempts": 3,
  "details": {
    "created_at": "2025-01-15T18:48:00.000Z",
    "processed_at": "2025-01-15T18:48:05.000Z",
    "finished_at": null,
    "failed_reason": null
  },
  "timestamp": "2025-01-15T18:50:00.000Z"
}
```

## 📊 GET /queue/stats

Monitor queue performance and status.

**Response:**

```json
{
  "queue_name": "potpie-analysis",
  "stats": {
    "waiting": 3,
    "active": 2,
    "completed": 45,
    "failed": 1,
    "total": 51
  },
  "worker_status": "running",
  "max_concurrency": 5,
  "max_retries": 3,
  "timestamp": "2025-01-15T18:50:00.000Z"
}
```

## 🔌 WebSocket Integration

### **Connection:**

```javascript
const socket = io('ws://localhost:8080');

// Join project room
socket.emit('join_project', 'project_id');

// Listen for status updates
socket.on('status_update', (data) => {
  console.log(`Status: ${data.status} - ${data.message}`);
});

// Listen for completion
socket.on('analysis_complete', (data) => {
  console.log('Analysis finished!');
  // Save data.data to vector database
  saveToVectorDB(data.data);
});

// Listen for errors
socket.on('analysis_error', (data) => {
  console.error('Analysis failed:', data.error);
});
```

### **WebSocket Events:**

| Event | Description | Data |
|-------|-------------|------|
| `status_update` | Job status changed | `{project_id, status, message, timestamp}` |
| `analysis_complete` | Analysis finished successfully | `{project_id, status: 'finished', data, timestamp}` |
| `analysis_error` | Analysis failed | `{project_id, status: 'failed', error, timestamp}` |

## 🔧 Redis Configuration

### **Basic Configuration:**
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password
REDIS_DB=1
```

### **TLS Configuration:**
```env
REDIS_TLS_ENABLED=true
REDIS_TLS_CERT_PATH=./certs/redis-client.crt
REDIS_TLS_REJECT_UNAUTHORIZED=true
```

### **Production Examples:**

**AWS ElastiCache:**
```env
REDIS_HOST=clustercfg.my-cluster.cache.amazonaws.com
REDIS_PORT=6379
REDIS_TLS_ENABLED=true
```

**Redis Cloud:**
```env
REDIS_HOST=redis-12345.c1.us-east-1-1.ec2.cloud.redislabs.com
REDIS_PORT=12345
REDIS_PASSWORD=your_cloud_password
REDIS_TLS_ENABLED=true
```

## 🐳 Docker Deployment

### Build and Run

```bash
# Build image
docker build -t coderide-potpie-service .

# Run with environment variables
docker run -p 8080:8080 \
  -e POTPIE_API_KEY=your_api_key \
  -e REDIS_HOST=redis_host \
  -e REDIS_PASSWORD=redis_password \
  coderide-potpie-service
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  potpie-service:
    build: .
    ports:
      - "8080:8080"
    environment:
      - POTPIE_API_KEY=your_api_key
      - REDIS_HOST=redis
      - REDIS_PASSWORD=redis_password
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass redis_password
    ports:
      - "6379:6379"
```

## ☸️ Kubernetes Deployment

### 1. Configure Secrets

Edit `kubernetes/deployment.yaml`:

```yaml
stringData:
  POTPIE_API_KEY: "your_actual_potpie_api_key_here"
  REDIS_PASSWORD: "your_redis_password"
```

### 2. Deploy

```bash
kubectl apply -f kubernetes/
```

### 3. Monitor

```bash
# Check pods
kubectl get pods -l app=potpie-service

# Check queue stats
kubectl port-forward svc/potpie-service 8080:80
curl http://localhost:8080/queue/stats
```

## 🔒 Security Features

### **Redis Security:**
- TLS encryption support
- Password authentication
- Certificate-based authentication
- Connection validation

### **Application Security:**
- GitHub token secure handling
- No token logging or persistence
- Input validation and sanitization
- Rate limiting via queue concurrency

### **Container Security:**
- Non-root user execution
- Minimal attack surface
- Security headers (Helmet.js)
- Secrets management

## 📊 Monitoring & Observability

### **Health Checks:**
- Service health: `GET /health`
- Queue statistics: `GET /queue/stats`
- Redis connectivity validation
- Potpie API connectivity check

### **Logging:**
```bash
# Docker logs
docker logs <container-id> -f

# Kubernetes logs
kubectl logs -l app=potpie-service -f
```

### **Metrics:**
- Queue depth and processing times
- Job success/failure rates
- Worker concurrency utilization
- WebSocket connection counts

## 🧪 Testing

### **Basic API Tests:**
```bash
npm test
```

### **WebSocket Integration Tests:**
```bash
npm run test:websocket
```

### **Custom Tests:**
```bash
# Test specific repository
node websocket-test-client.js facebook/react main "Explain React architecture"

# Test with private repo
node websocket-test-client.js --token ghp_xxx private-org/private-repo
```

## 🚀 Production Considerations

### **Scaling:**
- Horizontal scaling: Multiple service instances
- Worker scaling: Increase `MAX_CONCURRENT_JOBS`
- Redis clustering for high availability

### **Performance:**
- Queue optimization: Adjust retry policies
- Memory management: Configure job cleanup
- Connection pooling: Redis connection limits

### **Reliability:**
- Health check endpoints for load balancers
- Graceful shutdown handling
- Job persistence across restarts
- Automatic retry mechanisms

## 🐛 Troubleshooting

### **Common Issues:**

1. **"Analysis queue not initialized"**
   - Check Redis connection
   - Verify Redis credentials and TLS settings
   - Check network connectivity

2. **"Redis connection failed"**
   - Validate Redis host and port
   - Check TLS certificate path
   - Verify Redis server is running

3. **Jobs stuck in queue**
   - Check worker status: `GET /queue/stats`
   - Verify Potpie API connectivity
   - Check worker logs for errors

4. **WebSocket connection issues**
   - Verify CORS configuration
   - Check firewall rules
   - Validate WebSocket transport

### **Debug Commands:**
```bash
# Check queue status
curl http://localhost:8080/queue/stats

# Check specific job
curl http://localhost:8080/status/project_id

# Monitor logs
docker logs potpie-service -f
```

## 📄 License

© 2025 — Coderide by Simone

---

## ✅ Deployment Checklist

- [ ] Redis server configured and accessible
- [ ] Environment variables configured
- [ ] TLS certificates in place (if needed)
- [ ] Dependencies installed (`npm install`)
- [ ] Service tested locally (`npm run dev`)
- [ ] Docker image built and tested
- [ ] Kubernetes secrets configured
- [ ] Service deployed to cluster
- [ ] Health checks passing
- [ ] Queue statistics accessible
- [ ] WebSocket connections working
- [ ] Integration with backend tested
- [ ] Monitoring and alerting configured
