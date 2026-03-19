// ============================================
// Type Definitions
// ============================================

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

export interface NodeTypeConfig {
  id: string;
  label: string;
  color?: string;
  nodes: string[];
}

export interface GraphConfig {
  id: string;
  name: string;
  description?: string;
  height?: number;       // Canvas height (px), optional, defaults to 420
  triples: Triple[];
  nodeTypes: NodeTypeConfig[];
  defaultType?: {
    id: string;
    label: string;
    color?: string;
  };
}

export interface PluginSettings {
  showLabels: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  showLabels: true,
};

// D3 runtime node (with coordinates)
export interface GraphNode {
  id: string;
  name: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  pinned?: boolean;
}

// D3 runtime link
export interface GraphLink {
  source: GraphNode | string;
  target: GraphNode | string;
  relation: string;
  totalLinks?: number;
  linkIndex?: number;
  isForwardDir?: boolean;
}
