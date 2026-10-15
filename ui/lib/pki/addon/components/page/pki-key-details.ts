/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { invalidateListCache } from 'core/utils/list-with-capabilities';

import type RouterService from '@ember/routing/router-service';
import type FlashMessageService from 'vault/services/flash-messages';
import type { PkiReadKeyResponse } from '@hashicorp/vault-client-typescript';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type NamespaceService from 'vault/services/namespace';

interface Args {
  key: PkiReadKeyResponse;
}

export default class PkiKeyDetails extends Component<Args> {
  @service('app-router') declare readonly router: RouterService;
  @service declare readonly flashMessages: FlashMessageService;
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly namespace: NamespaceService;

  displayFields = ['key_id', 'key_name', 'key_type', 'key_bits'];

  get backend() {
    return this.secretMountPath.currentPath;
  }

  @action
  async deleteKey() {
    try {
      await this.api.secrets.pkiDeleteKey(this.args.key.key_id as string, this.backend);
      this.flashMessages.success('Key deleted successfully.');
      // Invalidate the PKI key list cache only after a successful delete, so the
      // next keys.index visit re-fetches from Vault and omits the removed key.
      // A failed delete must leave the cache intact.
      invalidateListCache(this.namespace.relativeNamespace, 'pki-keys', this.backend);
      this.router.transitionTo('vault.cluster.secrets.backend.pki.keys.index');
    } catch (error) {
      const { message } = await this.api.parseError(error);
      this.flashMessages.danger(message);
    }
  }
}
