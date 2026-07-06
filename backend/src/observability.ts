import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api';
import { config } from './config.js';

/**
 * OpenTelemetry tracing, env-gated. When OTEL_EXPORTER_OTLP_ENDPOINT is set the
 * NodeSDK exports OTLP/HTTP spans (Jaeger all-in-one ingests these directly);
 * when unset, @opentelemetry/api is a built-in no-op — withSpan() costs nothing
 * and the service runs fully offline. This keeps observability a deploy-time
 * choice, not a code path.
 */

interface Stoppable {
  shutdown(): Promise<void>;
}

let sdk: Stoppable | null = null;

export async function initTracing(): Promise<boolean> {
  if (!config.OTEL_EXPORTER_OTLP_ENDPOINT) return false;
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const node = new NodeSDK({
    serviceName: 'orbitops-backend',
    traceExporter: new OTLPTraceExporter({ url: config.OTEL_EXPORTER_OTLP_ENDPOINT }),
  });
  node.start();
  sdk = node;
  return true;
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown().catch(() => undefined);
  sdk = null;
}

const tracer = trace.getTracer('orbitops-backend');

/**
 * Run `fn` inside a named span with attributes. Errors are recorded on the span
 * and re-thrown; the return value passes through. No-op (zero overhead beyond a
 * call) when no SDK is registered.
 */
export async function withSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.end();
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.end();
      throw err;
    }
  });
}
