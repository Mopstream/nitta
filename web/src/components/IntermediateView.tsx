import { Graphviz } from "graphviz-react";
import React, { FC, useCallback, useContext } from "react";
import "react-table/react-table.css";

import { AppContext, IAppContext } from "app/AppContext";
import { GraphEdge, GraphNode } from "services/gen/types";
import {
  api,
  Dataflow,
  EndpointDecision,
  EndpointOptionData,
  IntermediateGraph,
  Node,
  SingleBind,
  GroupBind,
  UnitEndpointsData,
} from "services/HaskellApiService";
import { DownloadTextFile } from "utils/download";

import "components/Graphviz.scss";
import { useApiRequest } from "hooks/useApiRequest";
import { useApiResponse } from "hooks/useApiResponse";

/**
 * Component to display algorithm graph.
 */

export interface IIntermediateViewProps {}

interface ProcessState {
  bindeFuns: string[];
  transferedVars: string[];
}

interface Endpoints {
  sources: string[];
  targets: string[];
}

export const IntermediateView: FC<IIntermediateViewProps> = (props) => {
  const { selectedSid } = useContext(AppContext) as IAppContext;

  const algorithmGraph = useAlgorithmGraph(selectedSid);
  const procState = useProcState(selectedSid);
  const endpoints = useEndpoints(selectedSid);

  // TODO: is renderGraphJsonToDot expensive? may be a good idea to wrap expression in useMemo, otherwise it's called on
  // each rerender
  const dot = algorithmGraph ? renderGraphJsonToDot(algorithmGraph, procState, endpoints) : undefined;
  return (
    <div className="bg-light border graphvizContainer">
      {dot && (
        <>
          <Graphviz dot={dot} options={{ height: 399, width: "100%", zoom: true }} />
          <DownloadTextFile name={"algorithm.dot"} text={dot} />
        </>
      )}
    </div>
  );
};

interface DotOptions {
  [key: string]: any;
}

function isString(obj: any) {
  return typeof obj === "string" || obj instanceof String;
}

function renderDotOptions(options: DotOptions) {
  let result = [];
  let key: string;
  for (key in options) {
    let representation: string = isString(options[key]) ? `"${options[key]}"` : options[key];
    result.push(`${key}=${representation}`);
  }
  return `[${result.join("; ")}]`;
}

function isFunctionBound(bound: string[], node: GraphNode): boolean {
  if (bound.indexOf(node.function) >= 0) {
    return true;
  }
  for (let e of node.history) {
    if (bound.indexOf(e) >= 0) return true;
  }
  return false;
}

function renderGraphJsonToDot(json: IntermediateGraph, state: ProcessState, endpoints: Endpoints): string {
  let lines = [
    // "rankdir=LR"
  ];

  let nodes: string[] = json.nodes.map((node) => {
    return (
      node.id +
      " " +
      renderDotOptions({
        label: node.label,
        style: isFunctionBound(state.bindeFuns, node) ? "line" : "dashed",
      })
    );
  });
  function isTransfered(v: string): boolean {
    return state.transferedVars.indexOf(v) >= 0;
  }
  let edges = json.edges.map((edge) => {
    return (
      `${edge.from} -> ${edge.to} ` +
      renderDotOptions({
        label: edge.label,
        style: isTransfered(edge.label) ? "line" : "dashed",
        dir: "both",
        arrowhead: endpoints.targets.indexOf(edge.label) >= 0 || isTransfered(edge.label) ? "" : "o",
        arrowtail: endpoints.sources.indexOf(edge.label) >= 0 || isTransfered(edge.label) ? "dot" : "odot",
      })
    );
  });

  lines.push(...nodes);
  lines.push(...edges);

  const wrap = (content: string) => `\t${content};`;
  let result = `digraph {\n${lines.map(wrap).join("\n")}\n}`;
  return result;
}

function useAlgorithmGraph(selectedSid: string): IntermediateGraph | null {
  const response = useApiRequest({
    requester: useCallback(() => api.getIntermediateView(selectedSid), [selectedSid]),
  });
  const result = useApiResponse(response, makeGraphData, null);
  return result;
}

function makeGraphData(graphData: IntermediateGraph): IntermediateGraph | null {
  return {
    nodes: graphData.nodes.map((nodeData: GraphNode, index: number) => {
      return {
        id: index + 1,
        label: String(nodeData.label),
        function: nodeData.function,
        history: nodeData.history,
        nodeColor: "",
        nodeShape: "",
        fontSize: "",
        nodeSize: "",
      };
    }),
    edges: graphData.edges.map((edgeData: GraphEdge) => {
      return edgeData;
    }),
  };
}

function useProcState(selectedSid: string): ProcessState {
  const response = useApiRequest({ requester: useCallback(() => api.getRootPath(selectedSid), [selectedSid]) });
  const result = useApiResponse(response, makeProcState, defaultProcState);
  return result;
}

const defaultProcState: ProcessState = { bindeFuns: [], transferedVars: [] };

function makeProcState(nodes: Node[]): ProcessState {
  let procState: ProcessState = { bindeFuns: [], transferedVars: [] };
  nodes.forEach((n: Node) => {
    if (n.decision.tag === "DataflowDecisionView") {
      let targets = (n.decision as Dataflow).targets;
      targets.forEach((target: [string, EndpointDecision]) => {
        procState.transferedVars.push(target[1].epRole.contents as string);
      });
    }
    if (n.decision.tag === "SingleBindView") {
      let d = n.decision as SingleBind;
      procState.bindeFuns.push(d.function.fvFun, ...d.function.fvHistory);
    }

    if (n.decision.tag === "GroupBindView") {
      let groupBind = n.decision as GroupBind;
      Object.values(groupBind.bindGroup).forEach((functions) => {
        functions?.forEach((func) => {
          procState.bindeFuns.push(func.fvFun, ...func.fvHistory);
        });
      });
    }
  });
  return procState;
}

function useEndpoints(selectedSid: string): Endpoints {
  const response = useApiRequest({ requester: useCallback(() => api.getEndpoints(selectedSid), [selectedSid]) });
  const result = useApiResponse(response, collectEndpoints, defaultEndpoints);
  return result;
}

const defaultEndpoints: Endpoints = { sources: [], targets: [] };

function collectEndpoints(data: UnitEndpointsData[]): Endpoints {
  let endpoints: Endpoints = { sources: [], targets: [] };
  data.forEach((eps: UnitEndpointsData) => {
    eps.unitEndpoints.forEach((e: EndpointOptionData) => {
      let role = e.epRole;
      if (role.tag === "Source") {
        endpoints.sources.push(...role.contents);
      }
      if (role.tag === "Target") {
        endpoints.targets.push(role.contents);
      }
    });
  });
  return endpoints;
}
