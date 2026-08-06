/** Agent intelligent interaction component.
 *
 * Provides:
 * - Post-query export prompt (ask user if they want to export)
 * - Intelligent format recommendation based on data characteristics
 * - Natural language intent recognition for export requests
 */

import React, { useState, useEffect } from "react";
import { Modal, Button, Space, Typography, Tag, message, Input } from "antd";
import {
  DownloadOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FileOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { apiClient } from "../services/api";

const { Text, Title } = Typography;

interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, any>>;
  rowCount: number;
  executionTimeMs: number;
  sql: string;
}

interface AgentInteractionProps {
  databaseName: string;
  queryResult: QueryResult | null;
  onExport: (format: string) => void;
  onClose?: () => void;
  externalOpen?: boolean;
}

interface InteractionResponse {
  action: string;
  format?: string | null;
  message: string;
  recommended_format?: string;
  reason?: string;
  prompt?: string;
  options?: string[];
}

export const AgentInteraction: React.FC<AgentInteractionProps> = ({
  databaseName,
  queryResult,
  onExport,
  onClose,
  externalOpen,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [interactionData, setInteractionData] = useState<InteractionResponse | null>(null);
  const [userInput, setUserInput] = useState("");
  const [history, setHistory] = useState<Array<{ role: "user" | "agent"; text: string }>>([]);

  // Sync externalOpen with internal state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setModalOpen(externalOpen);
    }
  }, [externalOpen]);

  // Analyze data and generate prompt when query result changes
  useEffect(() => {
    if (queryResult && queryResult.rows.length > 0) {
      analyzeAndPrompt();
    }
  }, [queryResult]);

  const analyzeAndPrompt = async () => {
    if (!queryResult || !databaseName) return;

    setLoading(true);
    try {
      // Call backend interaction endpoint
      const response = await apiClient.post<InteractionResponse>(
        `/api/v1/dbs/${databaseName}/interaction`,
        {
          user_input: "",
          query_result: queryResult,
          action: "generate_prompt",
        }
      );

      setInteractionData(response.data);
      setHistory([
        {
          role: "agent",
          text: response.data.prompt || response.data.message,
        },
      ]);
      setModalOpen(true);
    } catch (error) {
      // Fallback: generate local prompt if backend fails
      const localPrompt = generateLocalPrompt(queryResult);
      setInteractionData(localPrompt);
      setHistory([
        {
          role: "agent",
          text: localPrompt.prompt || localPrompt.message,
        },
      ]);
      setModalOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const generateLocalPrompt = (result: QueryResult): InteractionResponse => {
    const { columns, rows } = result;
    const rowCount = rows.length;
    const colCount = columns.length;

    // Simple format recommendation logic
    const hasChinese = columns.some((col) =>
      /[\u4e00-\u9fa5]/.test(col.name)
    );
    const hasComplexData = rows.some((row) =>
      columns.some((col) => {
        const val = row[col.name];
        return typeof val === "object" && val !== null;
      })
    );

    let recommendedFormat = "csv";
    let reason = "通用格式";

    if (hasChinese || colCount > 10) {
      recommendedFormat = "excel";
      reason = "包含中文或多列数据，Excel 更适合格式化展示";
    } else if (hasComplexData) {
      recommendedFormat = "json";
      reason = "包含复杂/嵌套数据，JSON 更适合";
    }

    const prompt = `✅ 查询执行成功！共找到 ${rowCount} 行 ${colCount} 列数据。\n\n📊 **智能推荐**：建议导出为 **${recommendedFormat.toUpperCase()}** 格式。\n   原因：${reason}\n\n📁 **是否需要将这次查询结果导出为文件？**\n\n你可以：\n  • 点击下方按钮选择导出格式\n  • 输入命令如 "导出excel" 或 "export json"\n  • 输入 "是" 使用推荐格式`;

    return {
      action: "prompt",
      format: recommendedFormat,
      message: prompt,
      recommended_format: recommendedFormat,
      reason,
      prompt,
      options: ["csv", "json", "excel"],
    };
  };

  const handleFormatSelect = (format: string) => {
    setModalOpen(false);
    onExport(format);
    message.success(`正在导出为 ${format.toUpperCase()} 格式...`);
  };

  const handleSubmitUserInput = async () => {
    if (!userInput.trim()) return;

    const input = userInput.trim();
    setHistory((prev) => [...prev, { role: "user", text: input }]);
    setUserInput("");

    setLoading(true);
    try {
      // Call backend interaction endpoint
      const response = await apiClient.post<InteractionResponse>(
        `/api/v1/dbs/${databaseName}/interaction`,
        {
          user_input: input,
          query_result: queryResult,
          action: "process_response",
        }
      );

      const result = response.data;
      setInteractionData(result);
      setHistory((prev) => [...prev, { role: "agent", text: result.message }]);

      // Auto export if action is export
      if (result.action === "export" && result.format) {
        setTimeout(() => {
          handleFormatSelect(result.format!);
        }, 1000);
      } else if (result.action === "skip") {
        setTimeout(() => {
          setModalOpen(false);
        }, 500);
      }
    } catch (error) {
      // Fallback local processing
      const localResult = processLocalInput(input);
      setInteractionData(localResult);
      setHistory((prev) => [...prev, { role: "agent", text: localResult.message }]);

      if (localResult.action === "export" && localResult.format) {
        setTimeout(() => {
          handleFormatSelect(localResult.format!);
        }, 1000);
      } else if (localResult.action === "skip") {
        setTimeout(() => {
          setModalOpen(false);
        }, 500);
      }
    } finally {
      setLoading(false);
    }
  };

  const processLocalInput = (input: string): InteractionResponse => {
    const inputLower = input.toLowerCase();

    // Check affirmative responses
    const affirmativeWords = ["yes", "y", "ok", "好的", "可以", "是", "对", "导出", "export"];
    for (const word of affirmativeWords) {
      if (inputLower.includes(word.toLowerCase())) {
        const format = interactionData?.recommended_format || "csv";
        return {
          action: "export",
          format,
          message: `好的！正在使用推荐格式 ${format.toUpperCase()} 导出...`,
        };
      }
    }

    // Check format selection
    const formats = ["excel", "csv", "json"];
    for (const format of formats) {
      if (inputLower.includes(format)) {
        return {
          action: "export",
          format,
          message: `好的！正在导出为 ${format.toUpperCase()} 格式...`,
        };
      }
    }

    // Check negative responses
    const negativeWords = ["no", "n", "cancel", "不用", "不需要", "不", "算了", "skip"];
    for (const word of negativeWords) {
      if (inputLower.includes(word.toLowerCase())) {
        return {
          action: "skip",
          message: "好的，不导出。查询结果已在上方展示。",
        };
      }
    }

    // Default
    return {
      action: "unknown",
      message: "我可以帮你导出数据。请输入：csv、json、excel，或点击下方按钮选择格式。",
    };
  };

  const handleClose = () => {
    setModalOpen(false);
    setHistory([]);
    onClose?.();
  };

  const getFormatIcon = (format: string) => {
    switch (format) {
      case "excel":
        return <FileExcelOutlined />;
      case "json":
        return <FileTextOutlined />;
      case "csv":
        return <FileOutlined />;
      default:
        return <DownloadOutlined />;
    }
  };

  const getFormatColor = (format: string) => {
    switch (format) {
      case "excel":
        return "#217346";
      case "json":
        return "#8B5CF6";
      case "csv":
        return "#1677FF";
      default:
        return "#FAAD14";
    }
  };

  const recommendedFormat = interactionData?.recommended_format || interactionData?.format;

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined style={{ color: "#722ED1" }} />
          <span>智能助手 - 导出建议</span>
        </Space>
      }
      open={modalOpen}
      onCancel={handleClose}
      footer={null}
      width={560}
      closable
    >
      {/* History Messages */}
      <div
        style={{
          maxHeight: 200,
          overflowY: "auto",
          marginBottom: 16,
          padding: "12px",
          background: "#F5F5F5",
          borderRadius: 8,
          border: "1px solid #E8E8E8",
        }}
      >
        {history.map((msg, idx) => (
          <div
            key={idx}
            style={{
              marginBottom: idx < history.length - 1 ? 12 : 0,
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                padding: "8px 12px",
                background: msg.role === "user" ? "#E6F4FF" : "#FFFFFF",
                borderRadius: 8,
                border: msg.role === "user" ? "1px solid #91CAFF" : "1px solid #E8E8E8",
                maxWidth: "85%",
                whiteSpace: "pre-wrap",
                fontSize: 13,
              }}
            >
              {msg.role === "agent" && (
                <RobotOutlined style={{ marginRight: 6, color: "#722ED1" }} />
              )}
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      {/* Format Recommendation */}
      {recommendedFormat && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: "#FFFBE6",
            borderRadius: 8,
            border: "1px solid #FFE58F",
          }}
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text strong>
              <ThunderboltOutlined style={{ color: "#FAAD14", marginRight: 6 }} />
              智能推荐格式
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {interactionData?.reason || `根据数据特征，推荐使用 ${recommendedFormat.toUpperCase()} 格式`}
            </Text>
            <Button
              type="primary"
              icon={getFormatIcon(recommendedFormat)}
              onClick={() => handleFormatSelect(recommendedFormat)}
              style={{
                background: getFormatColor(recommendedFormat),
                borderColor: getFormatColor(recommendedFormat),
              }}
            >
              一键导出为 {recommendedFormat.toUpperCase()}
            </Button>
          </Space>
        </div>
      )}

      {/* Format Selection Buttons */}
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
          或选择其他格式：
        </Text>
        <Space wrap>
          {["csv", "json", "excel"].map((format) => (
            <Button
              key={format}
              icon={getFormatIcon(format)}
              onClick={() => handleFormatSelect(format)}
              style={{
                borderColor: recommendedFormat === format ? getFormatColor(format) : undefined,
                fontWeight: recommendedFormat === format ? 600 : 400,
              }}
            >
              {format.toUpperCase()}
            </Button>
          ))}
        </Space>
      </div>

      {/* Natural Language Input */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
          💡 支持自然语言：输入 "导出excel"、"是"、"不用" 等
        </Text>
        <Space.Compact style={{ width: "100%" }}>
          <Input
            placeholder="输入你的回复，如：导出excel、是、不用..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onPressEnter={handleSubmitUserInput}
            disabled={loading}
          />
          <Button
            type="primary"
            onClick={handleSubmitUserInput}
            loading={loading}
            disabled={!userInput.trim()}
          >
            发送
          </Button>
        </Space.Compact>
      </div>

      {/* Footer Actions */}
      <div style={{ marginTop: 16, textAlign: "right" }}>
        <Space>
          <Button onClick={handleClose}>稍后再说</Button>
        </Space>
      </div>
    </Modal>
  );
};

// Hook for easy integration
export const useAgentInteraction = () => {
  const [showInteraction, setShowInteraction] = useState(false);
  const [interactionResult, setInteractionResult] = useState<QueryResult | null>(null);

  const triggerInteraction = (result: QueryResult) => {
    setInteractionResult(result);
    setShowInteraction(true);
  };

  const InteractionComponent = (props: {
    databaseName: string;
    queryResult: QueryResult | null;
    onExport: (format: string) => void;
  }) => (
    <AgentInteraction
      databaseName={props.databaseName}
      queryResult={showInteraction ? interactionResult : null}
      onExport={(format) => {
        setShowInteraction(false);
        props.onExport(format);
      }}
      onClose={() => setShowInteraction(false)}
    />
  );

  return {
    triggerInteraction,
    InteractionComponent,
    showInteraction,
  };
};
