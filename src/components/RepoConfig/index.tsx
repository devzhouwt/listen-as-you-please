import React, { useState } from 'react';
import { Card, Form, Input, Button, message, Space, Typography, Alert } from 'antd';
import {
  CustomerServiceOutlined,
  UserOutlined,
  KeyOutlined,
  FolderOutlined,
  SafetyCertificateOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { createApi, fetchContents } from '@/api/gitee';
import { useAppStore } from '@/store';
import type { RepoConfig } from '@/api/types';
import './style.css';

const { Title, Text, Paragraph } = Typography;

const RepoConfig: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const setRepoConfig = useAppStore((s) => s.setRepoConfig);
  const clearRepoConfig = useAppStore((s) => s.clearRepoConfig);
  const closeConfig = useAppStore((s) => s.closeConfig);
  const repoConfig = useAppStore((s) => s.repoConfig);

  const handleSave = async (values: RepoConfig) => {
    setLoading(true);
    try {
      // 验证配置：尝试获取根目录内容
      const api = createApi(values.token);
      await fetchContents(api, values.owner, values.repo);
      
      setRepoConfig(values);
      message.success('仓库配置验证通过，已保存！');
    } catch (err: any) {
      const errorMsg = err?.response?.data?.message || err?.message || '验证失败';
      message.error(`配置验证失败: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    clearRepoConfig();
    message.success('已清除配置');
  };

  return (
    <div className="repo-config-container">
      <div className="repo-config-header">
        <Title level={2}>
          <CustomerServiceOutlined /> 随心听
        </Title>
        <Text type="secondary">将 Gitee 仓库作为个人云端音乐库</Text>
      </div>

      <Card className="repo-config-card" title="配置 Gitee 仓库">
        <Alert
          message="Token 仅保存在浏览器本地，不会上传至任何第三方服务器"
          type="info"
          showIcon
          icon={<SafetyCertificateOutlined />}
          style={{ marginBottom: 24 }}
        />

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={repoConfig || { owner: '', repo: '', token: '' }}
        >
          <Form.Item
            name="owner"
            label="仓库所有者（Owner）"
            rules={[{ required: true, message: '请输入仓库所有者' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="例如：your-username"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="repo"
            label="仓库名称（Repo）"
            rules={[{ required: true, message: '请输入仓库名称' }]}
          >
            <Input
              prefix={<FolderOutlined />}
              placeholder="例如：my-music"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="token"
            label="私人令牌（Token）"
            rules={[{ required: true, message: '请输入私人令牌' }]}
            extra="建议使用仅包含 projects 只读权限的 Token"
          >
            <Input.Password
              prefix={<KeyOutlined />}
              placeholder="请输入 Gitee 私人令牌"
              size="large"
            />
          </Form.Item>

          <Form.Item>
            <Space size="middle">
              <Button type="primary" htmlType="submit" loading={loading} size="large">
                保存并加载
              </Button>
              {repoConfig && (
                <Button icon={<ArrowLeftOutlined />} onClick={closeConfig} size="large">
                  返回
                </Button>
              )}
              <Button danger onClick={handleClear} size="large">
                清除配置
              </Button>
            </Space>
          </Form.Item>
        </Form>

        <div className="repo-config-guide">
          <Title level={5}>如何获取 Token？</Title>
          <Paragraph type="secondary">
            1. 登录 Gitee → 个人设置 → 安全设置 → 私人令牌<br />
            2. 点击「生成新令牌」，权限仅勾选「projects」（只读即可）<br />
            3. 复制生成的 Token 粘贴到上方输入框
          </Paragraph>
          <Title level={5}>仓库结构要求</Title>
          <Paragraph type="secondary">
            仓库根目录下的每个文件夹作为一个歌单，文件夹内的 .mp3 / .wav / .flac 等音频文件即为歌曲。
          </Paragraph>
        </div>
      </Card>
    </div>
  );
};

export default RepoConfig;
