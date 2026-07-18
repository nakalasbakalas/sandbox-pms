import { listApiRouteContracts } from './api-routes.mjs'

const successResponse = {
  description: 'Successful PMS response.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: { const: true },
          data: {},
          message: { type: 'string' },
        },
      },
    },
  },
}

const errorResponse = {
  description: 'Request rejected.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['ok', 'error'],
        properties: {
          ok: { const: false },
          error: { type: 'string' },
        },
      },
    },
  },
}

function operation(contract, method) {
  return {
    operationId: `${method.toLowerCase()}_${contract.path.replace(/^\/api\//, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    summary: contract.summary,
    tags: [contract.tag],
    ...(contract.parameters?.length ? { parameters: contract.parameters } : {}),
    security: contract.public ? [] : [{ cookieSession: [] }],
    responses: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      500: errorResponse,
    },
  }
}

export function createOpenApiDocument({ serverUrl = '/' } = {}) {
  const paths = {}
  for (const contract of listApiRouteContracts()) {
    paths[contract.path] ||= {}
    for (const method of contract.methods) {
      paths[contract.path][method.toLowerCase()] = operation(contract, method)
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Sandbox Hotel PMS API',
      version: '1.0.0',
      description: 'Incremental contract for the controlled Sandbox Hotel PMS backend. Existing staff routes remain backward compatible.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        cookieSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'pms_session',
        },
      },
    },
    paths,
  }
}
