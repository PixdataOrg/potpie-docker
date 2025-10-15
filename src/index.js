require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const PotpieClient = require('./potpieClient');

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize Potpie client
const potpieClient = new PotpieClient(process.env.POTPIE_API_KEY);

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
    service: 'Coderide Potpie Service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Health check with Potpie API validation
app.get('/health', async (req, res) => {
  try {
    const potpieHealth = await potpieClient.healthCheck();
    
    res.json({
      status: 'ok',
      service: 'Coderide Potpie Service',
      potpie_api: potpieHealth.success ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'Coderide Potpie Service',
      potpie_api: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Repository analysis endpoint - Complete flow with parsing, agents, and knowledge graph
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
          question: 'Explain the repository architecture',
          github_token: 'ghp_xxxxxxxxxxxxxxxxxxxx'
        }
      });
    }

    const repoName = repo;
    const branchName = branch || 'main';
    const analysisQuestion = question || 'Explain the repository architecture';

    console.log(`Starting analysis for repository: ${repoName}, branch: ${branchName}`);

    // Step 1: Parse repository
    console.log('Step 1: Initiating repository parsing...');
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
    console.log(`Repository parsing initiated. Project ID: ${projectId}`);

    // Step 2: Wait for parsing to complete
    console.log('Step 2: Waiting for parsing to complete...');
    const parsingResult = await potpieClient.waitForParsingComplete(projectId);
    
    if (!parsingResult.success) {
      return res.status(parsingResult.error.status || 500).json({
        success: false,
        error: 'Repository parsing failed or timed out',
        details: parsingResult.error,
        project_id: projectId,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`Parsing completed successfully for project ${projectId}`);

    // Step 3: Create conversation with codebase QnA agent
    console.log('Step 3: Creating conversation with codebase QnA agent...');
    const conversationResult = await potpieClient.createConversation(projectId, 'codebase_qna_agent');
    
    if (!conversationResult.success) {
      console.warn('Failed to create conversation, proceeding with knowledge graph queries');
    }

    // Step 4: Extract data using knowledge graph tools
    console.log('Step 4: Extracting repository data using knowledge graph...');
    
    // Get nodes from common tags
    const commonTags = ['function', 'class', 'module', 'component', 'service', 'controller', 'model'];
    const nodesResult = await potpieClient.getNodesFromTags(projectId, commonTags);
    
    let snippets = [];
    
    if (nodesResult.success && nodesResult.data.nodes) {
      console.log(`Found ${nodesResult.data.nodes.length} nodes from tags`);
      
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

    // Step 5: Ask knowledge graph query about the specific question
    console.log('Step 5: Querying knowledge graph with user question...');
    const queryResult = await potpieClient.askKnowledgeGraphQueries(projectId, analysisQuestion);
    
    let analysisResponse = null;
    if (queryResult.success) {
      analysisResponse = queryResult.data;
    }

    // Step 6: Compose final response for vector DB
    const vectorDbData = {
      project_id: projectId,
      repo: repoName,
      branch: branchName,
      question: analysisQuestion,
      parsing_status: parsingResult.data.status,
      snippets: snippets,
      snippets_count: snippets.length,
      analysis_response: analysisResponse,
      metadata: {
        parsed_at: new Date().toISOString(),
        total_nodes_found: nodesResult.success ? nodesResult.data.nodes?.length || 0 : 0,
        processed_nodes: snippets.length,
        has_github_token: !!github_token
      }
    };

    console.log(`Analysis completed. Extracted ${snippets.length} code snippets for vector DB`);

    res.json({
      success: true,
      data: vectorDbData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analysis endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during analysis',
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

    console.log(`Checking status for project: ${projectId}`);

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
      'POST /analyze': 'Analyze GitHub repository with full parsing flow',
      'GET /status/:projectId': 'Check parsing status of a project'
    },
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Coderide Potpie Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/`);
  console.log(`🔍 Analysis endpoint: http://localhost:${PORT}/analyze`);
  
  if (!process.env.POTPIE_API_KEY) {
    console.warn('⚠️  WARNING: POTPIE_API_KEY environment variable not set!');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
