using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Orbit.Bridge
{
    /// <summary>Minimal JSON writer for the bridge's answers (dictionaries, lists and primitives).</summary>
    internal static class OrbitJson
    {
        public static string Write(object value)
        {
            var sb = new StringBuilder();
            Append(sb, value);
            return sb.ToString();
        }

        private static void Append(StringBuilder sb, object value)
        {
            switch (value)
            {
                case null:
                    sb.Append("null");
                    break;
                case string s:
                    AppendString(sb, s);
                    break;
                case bool b:
                    sb.Append(b ? "true" : "false");
                    break;
                case float f:
                    sb.Append(float.IsNaN(f) || float.IsInfinity(f) ? "0" : f.ToString("R", CultureInfo.InvariantCulture));
                    break;
                case double d:
                    sb.Append(double.IsNaN(d) || double.IsInfinity(d) ? "0" : d.ToString("R", CultureInfo.InvariantCulture));
                    break;
                case int or long or short or byte or uint or ulong:
                    sb.Append(System.Convert.ToString(value, CultureInfo.InvariantCulture));
                    break;
                case IDictionary<string, object> dict:
                    sb.Append('{');
                    var first = true;
                    foreach (var pair in dict)
                    {
                        if (!first)
                        {
                            sb.Append(',');
                        }
                        first = false;
                        AppendString(sb, pair.Key);
                        sb.Append(':');
                        Append(sb, pair.Value);
                    }
                    sb.Append('}');
                    break;
                case IEnumerable list:
                    sb.Append('[');
                    var firstItem = true;
                    foreach (var item in list)
                    {
                        if (!firstItem)
                        {
                            sb.Append(',');
                        }
                        firstItem = false;
                        Append(sb, item);
                    }
                    sb.Append(']');
                    break;
                default:
                    AppendString(sb, value.ToString());
                    break;
            }
        }

        private static void AppendString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
