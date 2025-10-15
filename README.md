# 🧠 Coderide Potpie Service — Complete Microservice

A stateless microservice for analyzing GitHub repositories using [Potpie.ai](https://potpie.ai) APIs. This service orchestrates the complete flow from repository parsing to knowledge graph extraction, providing structured data ready for vector database storage.

## 📁 Project Structure

```
coderide-potpie-service/
├── src/
│   ├── index.js              # Main Express server with complete flow
│   └── potpieClient.js       # Potpie API v2 client with all endpoints
├── kubernetes/
│   ├── deployment.yaml       # Kubernetes deployment with secrets
│   └── service.yaml          # Kubernetes service and ingress
├── Dockerfile                # Docker container configuration
├── package.json              # Node.js dependencies and scripts
├── .env.example              # Environment variables template
├── .dockerignore             # Docker build exclusions
└── README.md                 # This file
```

## ⚙️ Prerequisites

- Node.js 20+
- Docker
- Kubernetes cluster (e.g., AWS Lightsail)
- Potpie.ai API key
- GitHub token for private repositories
- (Optional) Docker Hub or GitHub Container Registry account

## 🚀 Quick Start

### 1. Environment Setup

Copy the environment template and configure your API key:

```bash
cp .env.example .env
```

Edit `.env` and add your Potpie API key:

```env
PORT=8080
POTPIE_API_KEY=your_actual_potpie_api_key_here
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

Health check:

```bash
curl http://localhost:8080/
```

Analyze a repository (complete flow):

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
| GET | `/health` | Detailed health check with Potpie API status |
| POST | `/analyze` | Complete repository analysis flow |
| GET | `/status/:projectId` | Check parsing status of a project |

## 🔍 Complete Analysis Flow

The `/analyze` endpoint implements the full Potpie workflow:

### 1. Repository Parsing
- Initiates parsing with `POST /api/v2/parse`
- Supports private repositories with GitHub tokens
- Returns `project_id` for tracking

### 2. Status Monitoring
- Polls `GET /api/v2/parsing-status/{project_id}`
- Waits for status to become `ready`
- Handles timeout and error conditions

### 3. Agent Integration
- Creates conversation with `codebase_qna_agent`
- Supports multiple agent types (`debugging_agent`, etc.)

### 4. Knowledge Graph Extraction
- Extracts nodes using common tags (`function`, `class`, `module`, etc.)
- Retrieves code snippets for each node
- Queries knowledge graph with user questions

### 5. Structured Output
- Composes data ready for vector database storage
- Includes metadata, snippets, and analysis results

## 📊 POST /analyze

Analyzes a GitHub repository using the complete Potpie flow.

**Request Body:**

```json
{
  "repo": "org/repository-name",
  "branch": "main",
  "question": "Explain the authentication module",
  "github_token": "ghp_xxxxxxxxxxxxxxxxxxxx"
}
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `repo` | Yes | Repository name in format `org/repo-name` |
| `branch` | No | Branch name (default: `main`) |
| `question` | No | Analysis question (default: "Explain the repository architecture") |
| `github_token` | No | GitHub token for private repositories |

**Response:**

```json
{
  "success": true,
  "data": {
    "project_id": "abc123",
    "repo": "org/repository-name",
    "branch": "main",
    "question": "Explain the authentication module",
    "parsing_status": "ready",
    "snippets": [
      {
        "node_id": "n1",
        "file_path": "src/auth.js",
        "code": "function authenticate(token) { ... }",
        "tags": ["function", "authentication"],
        "description": "Main authentication function",
        "line_start": 10,
        "line_end": 25
      }
    ],
    "snippets_count": 45,
    "analysis_response": {
      "answer": "The authentication module...",
      "relevant_files": ["src/auth.js", "src/middleware/auth.js"]
    },
    "metadata": {
      "parsed_at": "2025-01-15T16:53:00.000Z",
      "total_nodes_found": 120,
      "processed_nodes": 45,
      "has_github_token": true
    }
  },
  "timestamp": "2025-01-15T16:53:00.000Z"
}
```

## 📈 GET /status/:projectId

Check the parsing status of a specific project.

**Response:**

```json
{
  "success": true,
  "project_id": "abc123",
  "status": "ready",
  "details": {
    "status": "ready",
    "progress": 100,
    "files_processed": 150,
    "nodes_extracted": 120
  },
  "timestamp": "2025-01-15T16:53:00.000Z"
}
```

## 🐳 Docker Deployment

### Build the Docker Image

```bash
docker build -t coderide-potpie-service .
```

### Run Locally with Docker

```bash
docker run -p 8080:8080 \
  -e POTPIE_API_KEY=your_api_key_here \
  coderide-potpie-service
```

### Push to Registry (Optional)

```bash
# Tag for your registry
docker tag coderide-potpie-service your-username/coderide-potpie-service:latest

# Push to Docker Hub
docker push your-username/coderide-potpie-service:latest
```

## ☸️ Kubernetes Deployment

### 1. Configure Secrets

Edit `kubernetes/deployment.yaml` and replace the placeholder API key:

```yaml
stringData:
  POTPIE_API_KEY: "your_actual_potpie_api_key_here"
```

### 2. Deploy to Kubernetes

```bash
kubectl apply -f kubernetes/
```

### 3. Verify Deployment

Check pods:

```bash
kubectl get pods -l app=potpie-service
```

Check service:

```bash
kubectl get svc potpie-service
```

Get external IP:

```bash
kubectl get svc potpie-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

## 🔧 Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 8080 | Server port |
| `POTPIE_API_KEY` | Yes | - | Your Potpie.ai API key |
| `LOG_LEVEL` | No | info | Logging level |
| `REQUEST_TIMEOUT` | No | 60000 | Request timeout in milliseconds |

### Potpie API Integration

The service integrates with Potpie API v2 endpoints:

- `POST /api/v2/parse` - Repository parsing
- `GET /api/v2/parsing-status/{project_id}` - Status monitoring
- `POST /api/v2/conversations` - Agent conversations
- `POST /api/v2/knowledge-graph/nodes-from-tags` - Node extraction
- `POST /api/v2/knowledge-graph/code-from-node` - Code retrieval
- `POST /api/v2/knowledge-graph/query` - Knowledge graph queries

## 🔒 Security Features

### GitHub Token Handling
- Secure token transmission for private repositories
- Token validation and error handling
- No token logging or persistence

### Container Security
- **Non-root container**: Runs as user ID 1001
- **Dropped capabilities**: Minimal container permissions
- **Secrets management**: API keys stored in Kubernetes secrets
- **Security headers**: Helmet.js for HTTP security
- **Input validation**: Request parameter validation
- **CORS enabled**: Cross-origin resource sharing configured

## 📊 Monitoring & Observability

### Health Checks
- **Liveness probe**: `GET /` - Basic service availability
- **Readiness probe**: `GET /health` - Service + Potpie API connectivity
- **Docker health check**: Container-level health monitoring

### Logging
The service provides comprehensive logging:

```bash
# Docker
docker logs <container-id>

# Kubernetes
kubectl logs -l app=potpie-service -f
```

### Performance Considerations
- **Parsing timeout**: 5 minutes maximum wait time
- **Node processing limit**: 50 nodes to avoid timeouts
- **Request timeout**: 60 seconds for API calls
- **Memory limits**: 512Mi maximum in Kubernetes

## 🧩 Integration with Coderide Backend

Use the service from your Coderide backend:

```javascript
const analyzeRepository = async (repo, branch, question, githubToken) => {
  const response = await fetch('https://potpie.coderide.dev/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo,
      branch,
      question,
      github_token: githubToken
    })
  });

  const result = await response.json();
  
  if (result.success) {
    // Save result.data to Supabase vector DB
    await saveToVectorDB(result.data);
    return result.data;
  } else {
    throw new Error(result.error);
  }
};
```

## 🐛 Troubleshooting

### Common Issues

1. **"POTPIE_API_KEY environment variable not set"**
   - Ensure your `.env` file exists and contains the API key
   - For Kubernetes, verify the secret is properly configured

2. **"Failed to initiate repository parsing"**
   - Check that your Potpie API key is valid and active
   - Verify the repository name format is correct (`org/repo-name`)

3. **"Repository parsing failed or timed out"**
   - Large repositories may take longer than 5 minutes
   - Check repository accessibility with the provided GitHub token

4. **"Failed to create conversation"**
   - This is non-critical; the service continues with knowledge graph extraction
   - Verify agent types are supported by your Potpie plan

### Error Codes

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing required parameter | `repo` parameter is required |
| 401 | Unauthorized | Invalid Potpie API key or GitHub token |
| 408 | Parsing timeout | Repository parsing exceeded 5 minutes |
| 500 | Internal server error | Potpie API error or service failure |

## 🚀 Future Enhancements

- **Multi-branch support**: Analyze multiple branches simultaneously
- **Caching layer**: Redis cache for repeated repository analyses
- **Webhook integration**: Real-time updates for repository changes
- **Advanced agents**: Support for custom Potpie agents
- **Batch processing**: Analyze multiple repositories in parallel
- **Metrics collection**: Prometheus metrics for monitoring

## 📄 License

© 2025 — Coderide by Simone

---

## ✅ Deployment Checklist

- [ ] Clone repository
- [ ] Configure `.env` file or Kubernetes secrets
- [ ] Install Node.js dependencies (`npm install`)
- [ ] Test locally (`npm run dev`)
- [ ] Build Docker image (`docker build`)
- [ ] Deploy to Kubernetes (`kubectl apply -f kubernetes/`)
- [ ] Verify service accessibility
- [ ] Test `/analyze` endpoint with private repository
- [ ] Test `/status/:projectId` endpoint
- [ ] Configure custom domain (optional)
- [ ] Set up monitoring and alerts
- [ ] Integrate with Coderide backend
- [ ] Test vector DB data storage
