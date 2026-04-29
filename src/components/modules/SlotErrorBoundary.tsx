"use client";

import { Component, type ReactNode } from "react";

interface Props {
  moduleName: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class SlotErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error(
      `[modules] UI slot from "${this.props.moduleName}" crashed:`,
      error
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <strong>{this.props.moduleName}</strong>: widget unavailable
        </div>
      );
    }
    return this.props.children;
  }
}
