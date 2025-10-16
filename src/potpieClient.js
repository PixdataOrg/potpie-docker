const axios = require('axios');

class PotpieClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://production-api.potpie.ai/';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 seconds timeout for parsing operations
    });
  }

  // Parse repository - starts the parsing process
  async parseRepository(repoName, branchName, githubToken) {
    try {
      const payload = {
        repo_name: repoName,
        branch_name: branchName
      };

      // Add GitHub token if provided (for private repos)
      if (githubToken) {
        payload.github_token = githubToken;
      }

      const response = await this.client.post('/api/v2/parse', payload);

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Potpie Parse API Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          details: error.response?.data || null
        }
      };
    }
  }

  // Check parsing status
  async getParsingStatus(projectId) {
    try {
      const response = await this.client.get(`/api/v2/parsing-status/${projectId}`);

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Potpie Parsing Status Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          details: error.response?.data || null
        }
      };
    }
  }

  // Wait for parsing to complete
  async waitForParsingComplete(projectId, maxWaitTime = 300000) { // 5 minutes max
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < maxWaitTime) {
      const statusResult = await this.getParsingStatus(projectId);
      
      if (!statusResult.success) {
        return statusResult;
      }

      const status = statusResult.data.status;
      console.log(`Parsing status for project ${projectId}: ${status}`);

      if (status === 'ready') {
        return {
          success: true,
          data: statusResult.data
        };
      }

      if (status === 'failed' || status === 'error') {
        return {
          success: false,
          error: {
            message: `Parsing failed with status: ${status}`,
            status: 500,
            details: statusResult.data
          }
        };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      error: {
        message: 'Parsing timeout - exceeded maximum wait time',
        status: 408,
        details: { projectId, maxWaitTime }
      }
    };
  }

  // Create conversation with agent
  async createConversation(projectId, agentType = 'codebase_qna_agent') {
    try {
      const response = await this.client.post('/api/v2/conversations', {
        project_id: projectId,
        agent_type: agentType
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Potpie Create Conversation Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          details: error.response?.data || null
        }
      };
    }
  }

  // Get nodes from tags using knowledge graph
  async getNodesFromTags(projectId, tags) {
    try {
      const response = await this.client.post('/api/v2/knowledge-graph/nodes-from-tags', {
        project_id: projectId,
        tags: tags
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Potpie Get Nodes From Tags Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          details: error.response?.data || null
        }
      };
    }
  }

  // Get code from node ID
  async getCodeFromNodeId(projectId, nodeId) {
    try {
      const response = await this.client.post('/api/v2/knowledge-graph/code-from-node', {
        project_id: projectId,
        node_id: nodeId
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Potpie Get Code From Node Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          details: error.response?.data || null
        }
      };
    }
  }

  // Ask knowledge graph queries
  async askKnowledgeGraphQueries(projectId, query) {
    try {
      const response = await this.client.post('/api/v2/knowledge-graph/query', {
        project_id: projectId,
        query: query
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Potpie Knowledge Graph Query Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          details: error.response?.data || null
        }
      };
    }
  }

  // Send message to conversation
  async sendMessage(conversationId, message) {
    try {
      const response = await this.client.post(`/api/v2/conversations/${conversationId}/messages`, {
        message: message
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Potpie Send Message Error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          details: error.response?.data || null
        }
      };
    }
  }

  // Legacy health check
  async healthCheck() {
    try {
      const response = await this.client.get('/health');
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500
        }
      };
    }
  }
}

module.exports = PotpieClient;
