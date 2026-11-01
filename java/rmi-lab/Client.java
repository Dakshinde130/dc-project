package lab.rmi;

import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;

public final class Client {
    public static void main(String[] args) throws Exception {
        Registry registry = LocateRegistry.getRegistry("127.0.0.1", 1099);
        Calculator stub = (Calculator) registry.lookup("CalculatorService");
        System.out.println("stub.add(21, 21) = " + stub.add(21, 21));
        System.out.println(stub.describe());
    }
}
