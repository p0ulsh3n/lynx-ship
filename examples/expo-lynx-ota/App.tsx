import { LynxView } from "@lynxship/expo";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <LynxView
        style={styles.lynx}
        bundle="main.lynx.bundle"
        initialData="{}"
        onReady={() => undefined}
      />
      <Text style={styles.caption}>LynxShip OTA fixture</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  lynx: { flex: 1 },
  caption: { padding: 12, textAlign: "center" },
});
