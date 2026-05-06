/**
 * Dock Provider - 面板管理上下文提供者
 *
 * 这个组件提供 dock 系统的 React Context
 * 允许子组件通过 hook 访问 dock 状态和方法
 */

"use client";

import React, { createContext, useContext, ReactNode } from "react";
import { useDockStore } from "@/stores/dock-store";
import type { DockContextValue } from "./types";

// ============ Context 创建 ============

/**
 * Dock Context
 * 用于在整个应用中共享 dock 状态和方法
 */
const DockContext = createContext<DockContextValue | undefined>(undefined);

// ============ Provider 组件 ============

/**
 * DockProvider 属性
 */
export interface DockProviderProps {
  /** 子组件 */
  children: ReactNode;
}

/**
 * DockProvider 组件
 * 包裹应用并提供 dock 管理功能
 */
export function DockProvider({ children }: DockProviderProps) {
  // 从 Zustand store 获取所有状态和方法
  const dockStore = useDockStore();

  return (
    <DockContext.Provider value={dockStore}>
      {children}
    </DockContext.Provider>
  );
}

// ============ 自定义 Hook ============

/**
 * useDockStore Hook
 * 用于在组件中访问 dock store
 *
 * @returns Dock store 状态和方法
 * @throws 如果在 DockProvider 外部使用则抛出错误
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { panels, handlePanelClick } = useDockStore();
 *
 *   return (
 *     <div>
 *       {panels.map(panel => (
 *         <button key={panel.id} onClick={() => handlePanelClick(panel.id)}>
 *           {panel.id}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDockContext(): DockContextValue {
  const context = useContext(DockContext);

  if (context === undefined) {
    throw new Error(
      "useDockContext must be used within a DockProvider. " +
        "Wrap your component tree with <DockProvider>."
    );
  }

  return context;
}

/**
 * useDockStore Hook 的别名
 * 为了保持一致性，导出两个名称
 */
export const useDockStoreContext = useDockContext;

// ============ 选择器 Hooks ============

/**
 * usePanels Hook
 * 仅获取所有面板的状态
 *
 * @returns 所有面板的状态数组
 */
export function usePanels() {
  return useDockStore((state) => state.panels);
}

/**
 * useActivePanelId Hook
 * 仅获取当前激活的面板 ID
 *
 * @returns 当前激活的面板 ID，如果没有则返回 null
 */
export function useActivePanelId() {
  return useDockStore((state) => state.activePanelId);
}

/**
 * usePanelState Hook
 * 获取指定面板的状态
 *
 * @param panelId 面板 ID
 * @returns 面板状态，如果不存在则返回 undefined
 */
export function usePanelState(panelId: string) {
  return useDockStore((state) =>
    state.panels.find((p) => p.id === panelId)
  );
}

/**
 * usePanelsByLocation Hook
 * 获取指定位置的所有面板
 *
 * @param location 面板位置
 * @returns 指定位置的面板数组
 */
export function usePanelsByLocation(location: string) {
  return useDockStore((state) =>
    state.panels.filter(
      (p) => p.location === location && p.mode === "docked"
    )
  );
}

/**
 * useDockActions Hook
 * 仅获取 dock 的操作方法，不获取状态
 *
 * @returns dock 操作方法集合
 */
export function useDockActions() {
  return useDockStore((state) => ({
    handlePanelClick: state.handlePanelClick,
    snapPanelToArea: state.snapPanelToArea,
    bringToFront: state.bringToFront,
    updatePanelState: state.updatePanelState,
    closePanel: state.closePanel,
    getPanelState: state.getPanelState,
    getPanelsByLocation: state.getPanelsByLocation,
    registerPanel: state.registerPanel,
    registerPanels: state.registerPanels,
    unregisterPanel: state.unregisterPanel,
    getPanelConfig: state.getPanelConfig,
    getAllPanelConfigs: state.getAllPanelConfigs,
  }));
}

// ============ 高阶组件 ============

/**
 * withDockStore HOC
 * 为组件注入 dock store
 *
 * @param Component 要包裹的组件
 * @returns 包裹后的组件
 *
 * @example
 * ```tsx
 * const MyComponent = withDockStore(({ panels, handlePanelClick }) => {
 *   return React.createElement('div', null, '...');
 * });
 * ```
 */
export function withDockStore<P extends object>(
  Component: React.ComponentType<P & { dockStore: DockContextValue }>
) {
  return function WrappedComponent(props: P) {
    const dockStore = useDockContext();
    return React.createElement(Component, { ...props, dockStore });
  };
}
