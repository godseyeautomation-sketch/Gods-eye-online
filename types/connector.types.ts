export type ConnectorAuthType = 'oauth' | 'api_key' | 'none';

export interface ConnectorPlatform {
  key: string;
  name: string;
  auth_type: ConnectorAuthType;
  icon: string;
  description: string;
  configured: boolean;
}

export interface UserConnector {
  id: string;
  platform: string;
  auth_type: ConnectorAuthType;
  account_info: Record<string, any>;
  scopes: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
