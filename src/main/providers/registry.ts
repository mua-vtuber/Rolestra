/**
 * Provider Registry — manages provider instances and lookup.
 *
 * Singleton that holds all registered providers. Provider persistence
 * (DB read/write) is handled by provider-handler; this module is
 * purely in-memory runtime state.
 */

import { BaseProvider } from './provider-interface';
import type { ProviderInfo } from '../../shared/provider-types';

class ProviderRegistry {
  private providers = new Map<string, BaseProvider>();

  /** Register a provider instance. Throws if ID already exists. */
  register(provider: BaseProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  /** Remove a provider, calling cooldown() first. */
  async unregister(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider not found: ${id}`);
    }
    await provider.cooldown();
    this.providers.delete(id);
  }

  /** Get a provider by ID, or undefined. */
  get(id: string): BaseProvider | undefined {
    return this.providers.get(id);
  }

  /** Get a provider by ID; throws if not found. */
  getOrThrow(id: string): BaseProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider not found: ${id}`);
    }
    return provider;
  }

  /** List all providers as serializable ProviderInfo. */
  listAll(): ProviderInfo[] {
    return [...this.providers.values()].map(p => p.toInfo());
  }

  /** Number of registered providers. */
  get size(): number {
    return this.providers.size;
  }

  /** Check if a provider with the given ID exists. */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /** Shutdown all providers (cooldown + clear). */
  async shutdownAll(): Promise<void> {
    const promises = [...this.providers.values()].map(p => p.cooldown());
    await Promise.allSettled(promises);
    this.providers.clear();
  }
}

/** Singleton registry instance. */
export const providerRegistry = new ProviderRegistry();
