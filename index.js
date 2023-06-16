const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(`${process.env.STRIPE_KEY}`);
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();

app.use(cors());
app.use(express.json());

const port = process.env.port || 4000;

const uri = `mongodb+srv://${process.env.USER_ID}:${process.env.USER_KEY}@cluster0.d2cwisz.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyJWT = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.USER_TOKEN, (error, decoded) => {
    if (error) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    client.connect();

    const classCollection = client.db("courseDB").collection("classes");
    const userCollection = client.db("courseDB").collection("users");
    const cartCollection = client.db("courseDB").collection("carts");
    const enrolledCollection = client.db("courseDB").collection("enrolled");
    const paymentCollection = client.db("courseDB").collection("payments");

    // SEND jwt token to client
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const result = jwt.sign(user, process.env.USER_TOKEN, {
        expiresIn: "24h",
      });

      res.send(result);
    });

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);

      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }
      next();
    };

    // Verify Instructor
    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);

      if (user?.role !== "instructor") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }
      next();
    };

    // GET all classes
    app.get("/classes", async (req, res) => {
      const difficulty = req.query.difficulty;

      let filter = {
        status: "active",
      };

      if (difficulty) {
        filter = {
          status: "active",
          difficulty: difficulty,
        };
      }

      const result = await classCollection.find(filter).toArray();
      res.send(result);
    });

    // GET class by id
    app.get("/classes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classCollection.findOne(query);
      res.send(result);
    });

    // GET polular classes
    app.get("/popular-classes", async (req, res) => {
      const sort = { enrolled: -1 };
      const result = await classCollection.find().sort(sort).toArray();
      res.send(result);
    });

    // GET all instructors
    app.get("/instructors", async (req, res) => {
      const filter = {
        role: "instructor",
      };
      const result = await userCollection.find(filter).toArray();
      res.send(result);
    });

    // GET all classes by email
    app.get("/instructor-classes/:email", async (req, res) => {
      const email = req.params.email;
      const filter = {
        instructorEmail: email,
        status: "active",
      };
      const result = await classCollection.find(filter).toArray();
      res.send(result);
    });

    // GET  instructor by id
    app.get("/instructors/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    // INSERT new user

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };

      const findUser = await userCollection.findOne(query);
      if (findUser) {
        return res.send({ userExist: true });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // CHECK  user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;

      const query = { email: email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role });
    });

    //POST carts
    app.post("/carts", verifyJWT, async (req, res) => {
      const cart = req.body;
      const filter = { classId: cart.classId };
      const exist = await cartCollection.findOne(filter);
      if (exist) {
        return res.send({ classExist: true });
      }
      const result = await cartCollection.insertOne(cart);
      res.send(result);
    });

    //DELETE cart by id
    app.delete("/carts/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // GET carts by user
    app.get("/carts/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res
          .status(401)
          .send({ error: true, message: "forbidden access" });
      }

      const query = {
        email: email,
      };

      const result = await cartCollection.find(query).toArray();

      res.send(result);
    });

    // create payment intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Payment
    app.post("/payments", verifyJWT, async (req, res) => {
      const item = req.body;
      const cartId = item.cartId;
      const classId = item.classId;

      const classFilter = {
        _id: new ObjectId(classId),
      };
      const cartFilter = {
        _id: new ObjectId(cartId),
      };

      const updatedClass = {
        $set: {
          seats: +item.seats - 1,
          enrolled: +item.enrolled + 1,
        },
      };

      await classCollection.updateOne(classFilter, updatedClass);
      await cartCollection.deleteOne(cartFilter);
      await enrolledCollection.insertOne(item);

      const result = await paymentCollection.insertOne(item);

      res.send(result);
    });

    // GET Enrolled by id
    app.get("/enrolled/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const email = req.decoded.email;
      const query = {
        classId: id,
        email: email,
      };
      const result = await enrolledCollection.findOne(query);
      res.send(result);
    });

    // GET Enrolled

    app.get("/enrolled", verifyJWT, async (req, res) => {
      const email = req.decoded.email;
      const query = {
        email: email,
      };

      const result = await enrolledCollection.find(query).toArray();
      res.send(result);
    });

    // GET payments

    app.get("/payments", verifyJWT, async (req, res) => {
      const sort = { date: -1 };

      const email = req.decoded.email;
      const query = {
        email: email,
      };

      const result = await paymentCollection.find(query).sort(sort).toArray();
      res.send(result);
    });

    // ADD a class
    app.post("/classes", verifyJWT, verifyInstructor, async (req, res) => {
      const item = req.body;
      const result = await classCollection.insertOne(item);
      res.send(result);
    });

    // GET all classes by instructor
    app.get("/myclasses", verifyJWT, verifyInstructor, async (req, res) => {
      const email = req.decoded.email;

      const filter = {
        instructorEmail: email,
      };
      const result = await classCollection.find(filter).toArray();
      res.send(result);
    });

    // GET my classes by id
    app.get("/myclasses/:id", async (req, res) => {
      const id = req.params.id;

      const filter = {
        _id: new ObjectId(id),
      };
      const result = await classCollection.findOne(filter);
      res.send(result);
    });

    // UPDATE my classes by id
    app.patch("/myclasses/:id", async (req, res) => {
      const data = req.body;
      const id = req.params.id;

      const filter = {
        _id: new ObjectId(id),
      };

      const updateItem = {
        $set: {
          name: data.name,
          seats: data.seats,
          price: data.price,
          difficulty: data.difficulty,
          image: data.image,
          info: data.info,
        },
      };

      const result = await classCollection.updateOne(filter, updateItem);
      res.send(result);
    });

    // Delete my classes by id
    app.delete(
      "/myclasses/:id",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const id = req.params.id;

        const filter = {
          _id: new ObjectId(id),
        };

        const result = await classCollection.deleteOne(filter);
        res.send(result);
      }
    );

    // GET All user
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const role = req.query.role;

      let filter = {};
      if (role) {
        filter = {
          role: role,
        };
      }

      const result = await userCollection.find(filter).toArray();
      res.send(result);
    });

    // GET All calsses
    app.get("/allclasses", verifyJWT, verifyAdmin, async (req, res) => {
      const status = req.query.status;

      let filter = {};
      if (status) {
        filter = {
          status: status,
        };
      }

      const result = await classCollection.find(filter).toArray();
      res.send(result);
    });

    // Delete user  by id
    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = {
        _id: new ObjectId(id),
      };
      const result = await userCollection.deleteOne(filter);
      res.send(result);
    });

    // Update user  role
    app.patch("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const data = req.body;

      const filter = {
        _id: new ObjectId(id),
      };
      const role = {
        $set: {
          role: data.role,
        },
      };

      const result = await userCollection.updateOne(filter, role);
      res.send(result);
    });

    // Post  calss
    app.post("/allclasses/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const data = req.body;
      const id = req.params.id;

      const filter = {
        _id: new ObjectId(id),
      };

      const update = {
        $set: {
          status: data.status,
          feedback: data.feedback || "",
        },
      };

      const result = await classCollection.updateOne(filter, update, {
        upsert: true,
      });
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (_, res) => {
  res.send("Hello World");
});

app.listen(port, () => {
  console.log(`App is running on port ${port}`);
});
