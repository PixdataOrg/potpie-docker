# 🚀 Deployment Guide - Potpie Service su Lightsail VPS

Guida rapida per deployare il microservizio Potpie sul tuo cluster Kubernetes Lightsail esistente.

## 📋 Setup Completato

- ✅ Lightsail VPS con Kubernetes
- ✅ Redis (`redis-client` o `valkey-0`) già configurato
- ✅ Microservizio BullMQ con monitoring implementato

## 🔐 Step 1: Configurare GitHub Secrets

Vai su GitHub → Settings → Secrets and variables → Actions e aggiungi:

| Secret Name | Valore | Descrizione |
|-------------|--------|-------------|
| `DOCKER_PASSWORD` | La tua password Docker Hub | Per push automatico immagini |
| `POTPIE_API_KEY` | La tua chiave Potpie.ai | API key per il servizio |
| `REDIS_PASSWORD` | Password del tuo Redis | Se il Redis ha password |
| `KUBE_CONFIG` | Kubeconfig base64 | Configurazione kubectl |

### Come ottenere KUBE_CONFIG:
```bash
# Dalla tua VPS Lightsail
kubectl config view --raw | base64 -w 0
```

## 🚀 Step 2: Deployment Automatico

### Opzione A: Push su main branch
```bash
git add .
git commit -m "Deploy potpie service"
git push origin main
```

### Opzione B: Deployment manuale
1. Vai su GitHub → Actions
2. Seleziona "Deploy Potpie Service to Lightsail Kubernetes"
3. Clicca "Run workflow"

## 📊 Step 3: Verificare il Deployment

### Dalla tua VPS Lightsail:
```bash
# Controllare i pods
kubectl get pods -l app=potpie-service

# Controllare il servizio
kubectl get svc potpie-service

# Vedere i logs
kubectl logs -l app=potpie-service -f

# Controllare Redis esistente
kubectl get svc | grep -E "(redis|valkey)"
```

### Testare il servizio:
```bash
# Ottenere IP esterno
EXTERNAL_IP=$(kubectl get svc potpie-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Test health
curl http://$EXTERNAL_IP/health

# Test queue stats
curl http://$EXTERNAL_IP/queue/stats

# Test metrics (Prometheus)
curl http://$EXTERNAL_IP/metrics
```

## 🧪 Step 4: Test Completo

### Avviare un'analisi:
```bash
curl -X POST http://$EXTERNAL_IP/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "facebook/react",
    "branch": "main", 
    "question": "Explain the component architecture"
  }'
```

### Controllare lo stato:
```bash
# Sostituisci PROJECT_ID con l'ID ritornato
curl http://$EXTERNAL_IP/status/PROJECT_ID
```

## 🔧 Troubleshooting

### Problemi comuni:

#### 1. Redis connection failed
```bash
# Verificare Redis
kubectl get pods | grep -E "(redis|valkey)"
kubectl get svc | grep -E "(redis|valkey)"

# Test connessione Redis
kubectl run redis-test --image=redis:alpine --rm -it -- redis-cli -h redis-client ping
```

#### 2. Image pull failed
```bash
# Verificare immagine su Docker Hub
docker pull digital@pixdata.io/coderide-potpie-service:latest

# Controllare eventi deployment
kubectl describe deployment potpie-service
```

#### 3. Pods non ready
```bash
# Logs dettagliati
kubectl logs -l app=potpie-service --previous

# Eventi pod
kubectl describe pods -l app=potpie-service
```

### Comandi utili:
```bash
# Status completo
kubectl get all -l app=potpie-service

# Eventi recenti
kubectl get events --sort-by='.lastTimestamp' | tail -20

# Restart deployment
kubectl rollout restart deployment/potpie-service

# Rollback
kubectl rollout undo deployment/potpie-service
```

## 📈 Monitoring

### Metriche disponibili su `/metrics`:
- `http_requests_total` - Richieste HTTP totali
- `queue_jobs_total` - Job in coda totali  
- `queue_job_duration_seconds` - Durata job
- `websocket_connections_active` - Connessioni WebSocket attive

### Dashboard Grafana (se disponibile):
```promql
# Request rate
rate(http_requests_total[5m])

# Queue depth  
queue_jobs_waiting + queue_jobs_active

# Success rate
rate(queue_jobs_total{status="completed"}[5m]) / rate(queue_jobs_total[5m])
```

## 🔄 Updates

### Aggiornare il servizio:
1. Modifica il codice
2. Commit e push su main
3. GitHub Actions deploierà automaticamente

### Deployment manuale (se necessario):
```bash
# Build locale
docker build -t digital@pixdata.io/coderide-potpie-service:latest .
docker push digital@pixdata.io/coderide-potpie-service:latest

# Deploy su Kubernetes
kubectl apply -f kubernetes/
kubectl rollout status deployment/potpie-service
```

## 🎯 Risultato Finale

Dopo il deployment avrai:

- ✅ **Microservizio Potpie** con BullMQ queue system
- ✅ **WebSocket real-time** per aggiornamenti stato
- ✅ **Monitoring Prometheus** con metriche custom
- ✅ **Auto-scaling** con 2 repliche
- ✅ **Health checks** automatici
- ✅ **Deployment automatico** via GitHub Actions

### Endpoint disponibili:
- `GET /` - Health check base
- `GET /health` - Health check dettagliato
- `POST /analyze` - Avvia analisi repository
- `GET /status/:projectId` - Stato analisi
- `GET /queue/stats` - Statistiche code
- `GET /metrics` - Metriche Prometheus
- `WebSocket /` - Aggiornamenti real-time

Il servizio è ora pronto per essere integrato con il tuo backend Coderide! 🎉
