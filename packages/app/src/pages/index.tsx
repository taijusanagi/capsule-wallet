import {
  Box,
  Button,
  Center,
  Flex,
  Heading,
  HStack,
  Icon,
  Image,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  SimpleGrid,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { signTypedData } from "@wagmi/core";
import WalletConnect from "@walletconnect/client";
import { convertHexToUtf8 } from "@walletconnect/utils";
import { NextPage } from "next";
import { useEffect, useState } from "react";
import { AiOutlineDown, AiOutlinePlus, AiOutlineQrcode } from "react-icons/ai";
import { FiExternalLink } from "react-icons/fi";
import { NFT } from "types/nft";
import { useNetwork, useSigner } from "wagmi";

import { FullModal, GeneralModal } from "@/components/elements/Modal";
import { DefaultLayout } from "@/components/layouts/Default";
import { useCapsuleWalletAPI } from "@/hooks/useCapsuleWalletApi";
import { useIsWagmiConnected } from "@/hooks/useIsWagmiConnected";
import { getDroppedNFTsByOwner, getNFTDropMintFunctionData } from "@/lib/contracts";
import { truncate } from "@/lib/utils";

import deployments from "../../../contracts/deployments.json";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const QrReader = require("react-qr-scanner");

const HomePage: NextPage = () => {
  /*
   * Hooks
   */
  const { data: signer } = useSigner();
  const { chain } = useNetwork();

  const { openConnectModal } = useConnectModal();
  const { isWagmiConnected } = useIsWagmiConnected();
  const { capsuleWalletAddress, capsuleWalletBalance, bundler, capsuleWalletAPI, getTransactionHashByRequestID } =
    useCapsuleWalletAPI();

  const qrReaderDisclosure = useDisclosure();
  const [descriptionIndex, setDescriptionIndex] = useState(0);
  const [isWalletConnectConnecting, setIsWalletConnectConnecting] = useState(false);
  const [isWalletConnectSessionEstablished, setIsWalletConnectSessionEstablished] = useState(false);
  const [walletConnectURI, setWalletConnectURI] = useState("");
  const [nfts, setNFTs] = useState<NFT[]>([]);

  /*
   * Functions
   */
  const onQRReaderScan = (result: { text: string }) => {
    if (!result) {
      return;
    }
    const walletConnectURI = result.text;
    setWalletConnectURI(walletConnectURI);
    connectWithWalletConnect(walletConnectURI);
    qrReaderDisclosure.onClose();
  };

  const onQRReaderError = (err: unknown) => {
    console.error(err);
  };

  const incrementDescriptionIndex = () => {
    setDescriptionIndex((prevIndex) => prevIndex + 1);
  };

  const connectWithWalletConnect = async (walletConnectURI: string) => {
    if (!chain || !signer || !bundler || !capsuleWalletAPI || !capsuleWalletAddress) {
      return;
    }

    setIsWalletConnectConnecting(true);
    try {
      let walletConnectConnector = new WalletConnect({
        uri: walletConnectURI,
      });
      if (walletConnectConnector.connected) {
        console.log("kill previous session and recreate session");
        await walletConnectConnector.killSession();
        walletConnectConnector = new WalletConnect({
          uri: walletConnectURI,
        });
      }
      walletConnectConnector.on("session_request", async (error, payload) => {
        console.log("session_request", payload);
        if (error) {
          throw error;
        }
        console.log("approving session");
        walletConnectConnector.approveSession({ chainId: chain.id, accounts: [capsuleWalletAddress] });
        console.log("session approved");
        setIsWalletConnectConnecting(false);
        setIsWalletConnectSessionEstablished(true);
      });
      walletConnectConnector.on("call_request", async (error, payload) => {
        console.log("call_request", payload);
        if (error) {
          throw error;
        }
        if (payload.method === "eth_sendTransaction") {
          console.log("eth_sendTransaction");
          const op = await capsuleWalletAPI.createSignedUserOp({
            target: payload.params[0].to,
            data: payload.params[0].data,
            value: payload.params[0].value,
            gasLimit: payload.params[0].gas,
          });
          console.log("user op", op);
          const requestId = await bundler.sendUserOpToBundler(op);
          console.log("request sent", requestId);
          const transactionHash = await getTransactionHashByRequestID(requestId);
          console.log("transactionHash", transactionHash);
          walletConnectConnector.approveRequest({
            id: payload.id,
            result: transactionHash,
          });
        }
        if (payload.method === "personal_sign") {
          console.log("personal_sign");
          const message = convertHexToUtf8(payload.params[0]);
          console.log("signing message");
          const signature = await signer.signMessage(message);
          console.log("signature", signature);
          walletConnectConnector.approveRequest({
            id: payload.id,
            result: signature,
          });
        }
        if (payload.method === "eth_signTypedData") {
          console.log("eth_signTypedData");
          console.log("signing message");
          console.log(payload.params[1]);
          const { domain, message: value, types } = JSON.parse(payload.params[1]);
          delete types.EIP712Domain;
          console.log(domain, types, value);
          const signature = await signTypedData({ domain, types, value });
          console.log("signature", signature);
          walletConnectConnector.approveRequest({
            id: payload.id,
            result: signature,
          });
        }
      });
      walletConnectConnector.on("disconnect", (error, payload) => {
        console.log("disconnect", payload);
        if (error) {
          throw error;
        }
        setIsWalletConnectConnecting(false);
        setIsWalletConnectSessionEstablished(false);
      });
    } catch (e) {
      console.error(e);
      setIsWalletConnectConnecting(false);
      setIsWalletConnectSessionEstablished(false);
    }
  };

  const mintNFT = async () => {
    if (!bundler || !capsuleWalletAPI) {
      return;
    }
    const data = getNFTDropMintFunctionData();
    const op = await capsuleWalletAPI.createSignedUserOp({
      target: deployments.nftDrop,
      data,
    });
    console.log("user op", op);
    const requestId = await bundler.sendUserOpToBundler(op);
    console.log("request sent", requestId);
    const transactionHash = await getTransactionHashByRequestID(requestId);
    console.log("transactionHash", transactionHash);
  };

  useEffect(() => {
    if (!signer || !signer.provider || !capsuleWalletAddress) {
      return;
    }
    getDroppedNFTsByOwner(signer.provider, capsuleWalletAddress).then((nfts) => {
      setNFTs(nfts);
    });
  }, [signer, capsuleWalletAddress]);

  return (
    <DefaultLayout>
      {!isWagmiConnected && (
        <Box maxW="lg" mx="auto" px="8" py="12" boxShadow={"md"} borderRadius="xl" bgColor={"white"}>
          <Stack spacing="4">
            <Heading fontWeight={"bold"} size={"xs"} color="gray.600" textAlign={"center"}>
              Capsule Wallet
            </Heading>
            {descriptionIndex === 0 && (
              <Stack>
                <Text align={"center"} fontSize="xs" fontWeight={"medium"} color="gray.600">
                  Encapsulated wallet by Account Abstraction
                </Text>
                <Center py="8">
                  <Image h="240" src="./img/security.svg" alt="security" objectFit={"contain"} />
                </Center>
              </Stack>
            )}
            {descriptionIndex === 1 && (
              <Stack>
                <Text align={"center"} fontSize="xs" fontWeight={"medium"} color="gray.600">
                  Capsule Wallet is Encapsulated security layer of your wallet
                </Text>
                <Center py="8">
                  <Image h="240" src="./img/concept.png" alt="security" objectFit={"contain"} />
                </Center>
              </Stack>
            )}
            {descriptionIndex === 2 && (
              <Stack>
                <Text align={"center"} fontSize="xs" fontWeight={"medium"} objectFit={"contain"} color="gray.600">
                  Burner wallets for better security but it is hard to manage
                </Text>
                <Center py="8">
                  <Image h="240" src="./img/burner-wallet.png" alt="security" objectFit={"contain"} />
                </Center>
              </Stack>
            )}
            {descriptionIndex === 3 && (
              <Stack>
                <Text align={"center"} fontSize="xs" fontWeight={"medium"} color="gray.600">
                  Capsule wallet provides security with better UX
                </Text>
                <Center py="8">
                  <Image h="240" src="./img/account-abstraction.png" alt="security" objectFit={"contain"} />
                </Center>
              </Stack>
            )}
            {descriptionIndex === 4 && (
              <Stack>
                <Text align={"center"} fontSize="xs" fontWeight={"medium"} color="gray.600">
                  Let&apos;s use Capsule Wallet for your crypto journey!
                </Text>
                <Center py="8">
                  <Image h="240" src="./img/unlock.svg" alt="unlock"></Image>
                </Center>
              </Stack>
            )}
            <Stack>
              <Button onClick={openConnectModal} colorScheme={"blue"} fontWeight="bold">
                Connect Wallet
              </Button>
              <HStack>
                <Button
                  w="full"
                  onClick={incrementDescriptionIndex}
                  fontWeight="bold"
                  color="gray.600"
                  disabled={descriptionIndex === 4}
                >
                  {descriptionIndex === 0 ? "What is it?" : "Next"}
                </Button>
              </HStack>
            </Stack>
          </Stack>
        </Box>
      )}
      {isWagmiConnected && (
        <Box>
          <Stack spacing="4">
            <Flex justify={"space-between"}>
              <Stack>
                <Heading fontWeight={"bold"} size={"xs"} color="gray.600">
                  Capsule Wallet
                </Heading>
                <Text fontSize={"x-small"} color="gray.600">
                  Encapsulated wallet by Account Abstraction
                </Text>
              </Stack>
              <Stack justifyContent={"center"}>
                <Menu>
                  <MenuButton as={Button} size="xs" color="gray.600" rightIcon={<AiOutlineDown />}>
                    {truncate(capsuleWalletAddress, 5, 5)}
                  </MenuButton>
                  <MenuList>
                    <MenuItem fontSize="x-small">{capsuleWalletAddress}</MenuItem>
                    <MenuDivider />
                    <Button size={"xs"} leftIcon={<AiOutlinePlus />} variant={"ghost"} w="full" disabled>
                      Add (not implemented)
                    </Button>
                  </MenuList>
                </Menu>
              </Stack>
            </Flex>
            <Stack spacing="4">
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <Box w="full" px="6" py="4" boxShadow={"md"} borderRadius="xl" bgColor={"white"}>
                  <Stack spacing="2">
                    <Text fontWeight={"bold"} fontSize="sm" color="gray.600">
                      Account
                    </Text>
                    <Stack spacing="1">
                      <Text fontWeight={"medium"} fontSize="xs" color="gray.600">
                        Address
                      </Text>
                      <Text fontSize="x-small" color="gray.600">
                        {capsuleWalletAddress}
                      </Text>
                    </Stack>
                    <Stack spacing="1">
                      <Text fontWeight={"medium"} fontSize="xs" color="gray.600">
                        Balance:
                      </Text>
                      <Text fontSize="xs" color="gray.600">
                        <Text fontWeight={"bold"} as="span" mr="1">
                          {capsuleWalletBalance}
                        </Text>
                        <Text as="span">ETH</Text>
                      </Text>
                    </Stack>
                  </Stack>
                </Box>
                <Box w="full" px="6" py="4" boxShadow={"md"} borderRadius="xl" bgColor={"white"}>
                  <Stack>
                    <Flex justify={"space-between"}>
                      <HStack justifyContent={"center"}>
                        <Text fontSize="sm" as="span" fontWeight={"bold"} color="gray.600">
                          WalletConnect
                        </Text>
                        <Button
                          size="xs"
                          variant="ghost"
                          as={"a"}
                          href="https://example.walletconnect.org/"
                          target="_blank"
                        >
                          <Icon as={FiExternalLink} aria-label="external-link" color="blue.500" w={4} h={4} />
                        </Button>
                      </HStack>
                      <Button
                        size="xs"
                        variant={"ghost"}
                        p="0"
                        borderRadius="none"
                        onClick={qrReaderDisclosure.onOpen}
                        disabled={isWalletConnectConnecting || isWalletConnectSessionEstablished}
                      >
                        <Icon as={AiOutlineQrcode} aria-label="qrcode" color="blue.500" w={6} h={6} cursor="pointer" />
                      </Button>
                    </Flex>
                    <Input
                      placeholder={"Paste wc: uri"}
                      type={"text"}
                      value={walletConnectURI}
                      fontSize="xs"
                      onChange={(e) => setWalletConnectURI(e.target.value)}
                      disabled={isWalletConnectConnecting || isWalletConnectSessionEstablished}
                    />
                    <Button
                      colorScheme={"blue"}
                      fontWeight="bold"
                      onClick={() => connectWithWalletConnect(walletConnectURI)}
                      isLoading={isWalletConnectConnecting}
                      disabled={isWalletConnectSessionEstablished}
                    >
                      {!isWalletConnectSessionEstablished ? "Connect" : "Connected"}
                    </Button>
                  </Stack>
                </Box>
              </SimpleGrid>
              <Flex justify={"center"}>
                <Tabs isFitted maxW="xl" w="full" defaultIndex={1}>
                  <TabList mb="1em">
                    <Tab>Tokens</Tab>
                    <Tab>Collectables</Tab>
                  </TabList>
                  <TabPanels>
                    <TabPanel px="6" py="4" boxShadow={"md"} borderRadius="xl" bgColor={"white"}>
                      <Flex justify={"space-between"}>
                        <Text fontWeight={"bold"} fontSize="sm" color="gray.600">
                          Tokens
                        </Text>
                        <Text color="gray.600" fontSize="xs">
                          * not implemented for this hackathon
                        </Text>
                      </Flex>
                    </TabPanel>
                    <TabPanel px="6" py="4" boxShadow={"md"} borderRadius="xl" bgColor={"white"}>
                      <Flex justify={"space-between"}>
                        <Text as="span" fontWeight={"bold"} fontSize="sm" color="gray.600">
                          Collectables
                        </Text>
                        <HStack>
                          <Button size="xs" onClick={mintNFT}>
                            Mint
                          </Button>
                          <Button size="xs" onClick={transferAll}>
                            Transfer all
                          </Button>
                        </HStack>
                      </Flex>
                      <SimpleGrid py="8" columns={{ base: 2, md: 4 }} spacing={4}>
                        {nfts.map((nft) => (
                          <Box key={nft.tokenId}>
                            <Image src={nft.image} alt="image" />
                          </Box>
                        ))}
                      </SimpleGrid>
                    </TabPanel>
                  </TabPanels>
                </Tabs>
              </Flex>
            </Stack>
          </Stack>
          <FullModal isOpen={qrReaderDisclosure.isOpen} onClose={qrReaderDisclosure.onClose}>
            <QrReader delay={500} onError={onQRReaderError} onScan={onQRReaderScan} />
          </FullModal>
        </Box>
      )}
    </DefaultLayout>
  );
};

export default HomePage;
