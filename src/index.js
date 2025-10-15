require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const PotpieClient = require('./potpieClient');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8080;

// Initialize Potpie client
const potpieClient = new PotpieClient(process.env.POTPIE_API_KEY);

// In-memory storage for active analysis jobs
const activeJobs = new Map();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Coderide Potpie Service (WebSocket)',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    active_jobs: activeJobs.size
  });
});

// Health check with Potpie API validation
app.get('/health', async (req, res) => {
  try {
    const potpieHealth = await potpieClient.healthCheck();
    
    res.json({
      status: 'ok',
      service: 'Coderide Potpie Service (WebSocket)',
      potpie_api: potpieHealth.success ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      active_jobs: activeJobs.size,
      websocket_connections: io.engine.clientsCount
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'Coderide Potpie Service (WebSocket)',
      potpie_api: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Repository analysis endpoint - Asynchronous with WebSocket updates
app.post('/analyze', async (req, res) => {
  try {
    const { repo, branch, question, github_token } = req.body;

    // Validate required parameters
    if (!repo) {
      return res.status(400).json({
        error: 'Missing required parameter: repo',
        example: {
          repo: 'org/repository-name',
          branch: 'main',
          question: 'Explain the authentication module',
          github_token: 'ghp_xxxxxxxxxxxxxxxxxxxx'
        }
      });
    }

    const repoName = repo;
    const branchName = branch || 'main';
    const analysisQuestion = question || 'Explain the repository architecture';

    console.log(`Starting asynchronous analysis for repository: ${repoName}, branch: ${branchName}`);

    // Step 1: Initiate repository parsing
    const parseResult = await potpieClient.parseRepository(repoName, branchName, github_token);
    
    if (!parseResult.success) {
      return res.status(parseResult.error.status || 500).json({
        success: false,
        error: 'Failed to initiate repository parsing',
        details: parseResult.error,
        timestamp: new Date().toISOString()
      });
    }

    const projectId = parseResult.data.project_id;
    
    // Store job information
    const jobInfo = {
      project_id: projectId,
      repo: repoName,
      branch: branchName,
      question: analysisQuestion,
      github_token: github_token,
      status: 'parsing',
      started_at: new Date().toISOString(),
      socket_room: `project_${projectId}`
    };
    
    activeJobs.set(projectId, jobInfo);

    // Start background processing
    processRepositoryAnalysis(projectId);

    // Return immediately with project_id
    res.json({
      success: true,
      project_id: projectId,
      status: 'parsing',
      message: 'Repository analysis started. Connect to WebSocket for real-time updates.',
      websocket_endpoint: `/ws/${projectId}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analysis endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during analysis initiation',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Project status endpoint
app.get('/status/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({
        error: 'Missing project ID parameter',
        timestamp: new Date().toISOString()
      });
    }

    // Check if job exists in memory
    const jobInfo = activeJobs.get(projectId);
    if (jobInfo) {
      return res.json({
        success: true,
        project_id: projectId,
        status: jobInfo.status,
        details: jobInfo,
        timestamp: new Date().toISOString()
      });
    }

    // If not in memory, check with Potpie directly
    const statusResult = await potpieClient.getParsingStatus(projectId);

    if (statusResult.success) {
      res.json({
        success: true,
        project_id: projectId,
        status: statusResult.data.status,
        details: statusResult.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(statusResult.error.status || 500).json({
        success: false,
        project_id: projectId,
        error: statusResult.error.message,
        details: statusResult.error.details,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Status endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`WebSocket client connected: ${socket.id}`);

  // Join project-specific room
  socket.on('join_project', (projectId) => {
    const room = `project_${projectId}`;
    socket.join(room);
    console.log(`Client ${socket.id} joined room ${room}`);
    
    // Send current status if job exists
    const jobInfo = activeJobs.get(projectId);
    if (jobInfo) {
      socket.emit('status_update', {
        project_id: projectId,
        status: jobInfo.status,
        message: getStatusMessage(jobInfo.status),
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`WebSocket client disconnected: ${socket.id}`);
  });
});

// Background processing function
async function processRepositoryAnalysis(projectId) {
  const jobInfo = activeJobs.get(projectId);
  if (!jobInfo) return;

  const room = jobInfo.socket_room;

  try {
    // Emit initial parsing status
    io.to(room).emit('status_update', {
      project_id: projectId,
      status: 'parsing',
      message: 'Repository parsing in progress...',
      timestamp: new Date().toISOString()
    });

    // Step 2: Wait for parsing to complete
    console.log(`Waiting for parsing to complete for project ${projectId}...`);
    const parsingResult = await potpieClient.waitForParsingComplete(projectId);
    
    if (!parsingResult.success) {
      jobInfo.status = 'failed';
      jobInfo.error = parsingResult.error;
      
      io.to(room).emit('analysis_error', {
        project_id: projectId,
        status: 'failed',
        error: 'Repository parsing failed or timed out',
        details: parsingResult.error,
        timestamp: new Date().toISOString()
      });
      
      activeJobs.delete(projectId);
      return;
    }

    // Update status to ready
    jobInfo.status = 'ready';
    io.to(room).emit('status_update', {
      project_id: projectId,
      status: 'ready',
      message: 'Parsing completed, starting conversations...',
      timestamp: new Date().toISOString()
    });

    // Step 3: Start conversation processing
    jobInfo.status = 'processing_conversations';
    io.to(room).emit('status_update', {
      project_id: projectId,
      status: 'processing_conversations',
      message: 'Extracting knowledge graph and running conversations...',
      timestamp: new Date().toISOString()
    });

    console.log(`Starting conversation processing for project ${projectId}...`);

    // Create conversation with codebase QnA agent
    const conversationResult = await potpieClient.createConversation(projectId, 'codebase_qna_agent');
    
    if (!conversationResult.success) {
      console.warn(`Failed to create conversation for project ${projectId}, proceeding with knowledge graph queries`);
    }

    // Extract data using knowledge graph tools
    const commonTags = ['function', 'class', 'module', 'component', 'service', 'controller', 'model'];
    const nodesResult = await potpieClient.getNodesFromTags(projectId, commonTags);
    
    let snippets = [];
    
    if (nodesResult.success && nodesResult.data.nodes) {
      console.log(`Found ${nodesResult.data.nodes.length} nodes for project ${projectId}`);
      
      // Get code for each node (limit to first 50 to avoid timeout)
      const nodesToProcess = nodesResult.data.nodes.slice(0, 50);
      
      for (const node of nodesToProcess) {
        const codeResult = await potpieClient.getCodeFromNodeId(projectId, node.id);
        
        if (codeResult.success) {
          snippets.push({
            node_id: node.id,
            file_path: node.file_path || 'unknown',
            code: codeResult.data.code || '',
            tags: node.tags || [],
            description: node.description || '',
            line_start: node.line_start || 0,
            line_end: node.line_end || 0
          });
        }
      }
    }

    // Ask knowledge graph query about the specific question
    const queryResult = await potpieClient.askKnowledgeGraphQueries(projectId, jobInfo.question);
    
    let analysisResponse = null;
    if (queryResult.success) {
      analysisResponse = queryResult.data;
    }

    // Step 4: Compose final response for vector DB
    const vectorDbData = {
      project_id: projectId,
      repo: jobInfo.repo,
      branch: jobInfo.branch,
      question: jobInfo.question,
      parsing_status: parsingResult.data.status,
      snippets: snippets,
      snippets_count: snippets.length,
      analysis_response: analysisResponse,
      metadata: {
        parsed_at: new Date().toISOString(),
        total_nodes_found: nodesResult.success ? nodesResult.data.nodes?.length || 0 : 0,
        processed_nodes: snippets.length,
        has_github_token: !!jobInfo.github_token,
        processing_time_ms: Date.now() - new Date(jobInfo.started_at).getTime()
      }
    };

    // Update job status to finished
    jobInfo.status = 'finished';
    jobInfo.result = vectorDbData;

    console.log(`Analysis completed for project ${projectId}. Extracted ${snippets.length} code snippets.`);

    // Emit final result
    io.to(room).emit('analysis_complete', {
      project_id: projectId,
      status: 'finished',
      data: vectorDbData,
      message: 'Analysis completed successfully. Data ready for vector DB.',
      timestamp: new Date().toISOString()
    });

    // Clean up job after 1 hour
    setTimeout(() => {
      activeJobs.delete(projectId);
      console.log(`Cleaned up job data for project ${projectId}`);
    }, 3600000); // 1 hour

  } catch (error) {
    console.error(`Error processing analysis for project ${projectId}:`, error);
    
    jobInfo.status = 'failed';
    jobInfo.error = error.message;
    
    io.to(room).emit('analysis_error', {
      project_id: projectId,
      status: 'failed',
      error: 'Internal server error during analysis',
      message: error.message,
      timestamp: new Date().toISOString()
    });
    
    activeJobs.delete(projectId);
  }
}

// Helper function to get status messages
function getStatusMessage(status) {
  const messages = {
    'parsing': 'Repository parsing in progress...',
    'ready': 'Parsing completed, starting conversations...',
    'processing_conversations': 'Extracting knowledge graph and running conversations...',
    'finished': 'Analysis completed successfully. Data ready for vector DB.',
    'failed': 'Analysis failed. Check error details.'
  };
  return messages[status] || 'Unknown status';
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    available_endpoints: {
      'GET /': 'Service health check',
      'GET /health': 'Detailed health check with Potpie API status',
      'POST /analyze': 'Start asynchronous repository analysis',
      'GET /status/:projectId': 'Check parsing status of a project',
      'WebSocket /': 'Real-time analysis updates (use join_project event)'
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Coderide Potpie Service (WebSocket) running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/`);
  console.log(`🔍 Analysis endpoint: http://localhost:${PORT}/analyze`);
  console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/`);
  
  if (!process.env.POTPIE_API_KEY) {
    console.warn('⚠️  WARNING: POTPIE_API_KEY environment variable not set!');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  io.close();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  io.close();
  server.close(() => {
    process.exit(0);
  });
});
